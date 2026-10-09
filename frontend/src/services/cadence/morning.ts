import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { errorMessage, mapLimit } from "@/lib/concurrency";
import { anthropic } from "@/services/llm/client";
import { logUsage } from "@/services/llm/tracked";
import { usageFromApi } from "@/services/llm/pricing";
import { applyGuardrails, buildDraftRequest, DraftSchema, parseDraftMessage, type DraftInput } from "@/services/drafting/draft";
import { getActiveTemplates } from "@/services/drafting/templates";
import { checkThread } from "@/services/gmail/gmail";
import { cadenceDate, localDate, type EmailDay } from "./calendar";
import { effectiveSettings, stopProspect } from "./actions";
import { getAppSettings, loadDraftInput } from "./context";
import { draftAndStore } from "./upload";

const FOLLOW_UP_DAYS: EmailDay[] = [4, 7, 12];
export const BATCH_MIN = 5; // below this, synchronous calls finish faster and the saving is negligible
const BATCH_DEADLINE_MS = 75 * 60_000;
const BATCH_POLL_MS = 30_000;

type Prospect = typeof schema.prospects.$inferSelect;

/** Next follow-up day that has no email yet, if it is due on or before `today`. */
export function nextDueDay(day1: string, existingDays: number[], today: string, holidays: string[]): EmailDay | null {
  const next = FOLLOW_UP_DAYS.find((d) => !existingDays.includes(d));
  if (!next) return null;
  return cadenceDate(day1, next, holidays) <= today ? next : null;
}

export async function hasMorningRun(userId: string, today: string): Promise<boolean> {
  const [run] = await db
    .select({ id: schema.dailyRuns.id })
    .from(schema.dailyRuns)
    .where(and(eq(schema.dailyRuns.userId, userId), eq(schema.dailyRuns.runDate, today), eq(schema.dailyRuns.kind, "morning")));
  return !!run;
}

/** Daily job per SDR: stop replied/bounced cadences and draft today's Day 4/7/12 follow-ups for review. */
export async function morningRun(userId: string): Promise<Record<string, number>> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) throw new Error("SDR not found");
  const settings = effectiveSettings(user);
  const today = localDate(new Date(), settings.timezone);
  if (await hasMorningRun(userId, today)) return { alreadyRan: 1 };

  const [run] = await db.insert(schema.dailyRuns).values({ userId, runDate: today, kind: "morning" }).returning();
  const ctx = { runId: run.id, userId };
  const stats: Record<string, number> = { expired: 0, due: 0, stoppedReplied: 0, stoppedBounced: 0, drafted: 0, failed: 0, batched: 0 };

  try {
    // 1. Yesterday's unreviewed emails expire (the SDR can "send tomorrow" them from the review page).
    const expired = await db
      .update(schema.emails)
      .set({ status: "expired", updatedAt: new Date() })
      .where(and(eq(schema.emails.userId, userId), eq(schema.emails.status, "pending_review"), lt(schema.emails.dueDate, today)))
      .returning({ id: schema.emails.id });
    stats.expired = expired.length;

    // 2. Who is due a follow-up today?
    const prospects = await db
      .select()
      .from(schema.prospects)
      .where(and(eq(schema.prospects.userId, userId), eq(schema.prospects.status, "active"), isNotNull(schema.prospects.threadId), isNotNull(schema.prospects.day1Date)));
    const existing = prospects.length
      ? await db
          .select({ prospectId: schema.emails.prospectId, day: schema.emails.day })
          .from(schema.emails)
          .where(inArray(schema.emails.prospectId, prospects.map((p) => p.id)))
      : [];
    const due: { prospect: Prospect; day: EmailDay }[] = [];
    for (const p of prospects) {
      const days = existing.filter((e) => e.prospectId === p.id).map((e) => e.day);
      const day = nextDueDay(p.day1Date!, days, today, settings.holidays ?? []);
      if (day) due.push({ prospect: p, day });
    }

    // 3. Reply / bounce check before spending any tokens.
    const live: typeof due = [];
    await mapLimit(due, 5, async (d) => {
      const thread = await checkThread(userId, user.email, d.prospect.threadId!);
      if (thread === "none") return live.push(d);
      await stopProspect(userId, d.prospect.id, thread, thread === "replied" ? "Prospect replied" : "Email bounced");
      stats[thread === "replied" ? "stoppedReplied" : "stoppedBounced"]++;
    });
    stats.due = live.length;

    // 4. Draft.
    const templates = await getActiveTemplates();
    const allow = (await getAppSettings()).referenceableClients ?? [];
    if (live.length >= BATCH_MIN) {
      const { done, leftovers } = await draftViaBatch(ctx, run.id, live, today, templates, allow);
      stats.batched = done;
      stats.drafted += done;
      const sync = await mapLimit(leftovers, 3, (d) => draftAndStore({ ...ctx, prospectId: d.prospect.id }, d.prospect, d.day, today, templates, allow));
      stats.drafted += sync.filter((r) => r.status === "fulfilled").length;
      stats.failed += sync.filter((r) => r.status === "rejected").length;
    } else {
      const sync = await mapLimit(live, 3, (d) => draftAndStore({ ...ctx, prospectId: d.prospect.id }, d.prospect, d.day, today, templates, allow));
      stats.drafted = sync.filter((r) => r.status === "fulfilled").length;
      stats.failed = sync.filter((r) => r.status === "rejected").length;
    }

    await db.update(schema.dailyRuns).set({ status: "done", stats, finishedAt: new Date() }).where(eq(schema.dailyRuns.id, run.id));
    return stats;
  } catch (err) {
    await db
      .update(schema.dailyRuns)
      .set({ status: "failed", error: errorMessage(err), stats, finishedAt: new Date() })
      .where(eq(schema.dailyRuns.id, run.id));
    throw err;
  }
}

/** Drafts via the Message Batches API (50% cheaper). Returns items that must fall back to synchronous drafting. */
async function draftViaBatch(
  ctx: { runId: string; userId: string },
  runId: string,
  items: { prospect: Prospect; day: EmailDay }[],
  today: string,
  templates: Awaited<ReturnType<typeof getActiveTemplates>>,
  allow: string[],
): Promise<{ done: number; leftovers: typeof items }> {
  const leftovers: typeof items = [];
  const prepared: { emailId: string; item: (typeof items)[number]; input: DraftInput }[] = [];

  // Cached research only; sorted by industry so the prompt-cache prefix lines up.
  for (const item of items) {
    const [row] = await db
      .insert(schema.emails)
      .values({ prospectId: item.prospect.id, userId: item.prospect.userId, day: item.day, dueDate: today, status: "generating" })
      .onConflictDoUpdate({ target: [schema.emails.prospectId, schema.emails.day], set: { status: "generating", updatedAt: new Date() } })
      .returning();
    try {
      prepared.push({ emailId: row.id, item, input: await loadDraftInput({ ...ctx, prospectId: item.prospect.id, emailId: row.id }, item.prospect, item.day) });
    } catch (err) {
      console.error(`[morning] context failed for ${item.prospect.id}`, err);
      leftovers.push(item);
    }
  }
  prepared.sort((a, b) => a.input.industryKey.localeCompare(b.input.industryKey));
  if (!prepared.length) return { done: 0, leftovers };

  const client = anthropic();
  const batch = await client.messages.batches.create({
    requests: prepared.map((p) => {
      const params = buildDraftRequest(p.input, templates);
      return { custom_id: p.emailId, params: { ...params, output_config: { ...params.output_config, format: zodOutputFormat(DraftSchema) } } };
    }),
  });
  await db.update(schema.dailyRuns).set({ batchId: batch.id }).where(eq(schema.dailyRuns.id, runId));

  const deadline = Date.now() + BATCH_DEADLINE_MS;
  let status = batch.processing_status;
  while (status !== "ended" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, BATCH_POLL_MS));
    status = (await client.messages.batches.retrieve(batch.id)).processing_status;
  }
  if (status !== "ended") {
    await client.messages.batches.cancel(batch.id);
    // Cancellation finishes quickly; collect whatever already succeeded.
    while ((await client.messages.batches.retrieve(batch.id)).processing_status !== "ended") {
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }

  const byId = new Map(prepared.map((p) => [p.emailId, p]));
  let done = 0;
  for await (const result of await client.messages.batches.results(batch.id)) {
    const p = byId.get(result.custom_id);
    if (!p) continue;
    byId.delete(result.custom_id);
    if (result.result.type !== "succeeded") {
      leftovers.push(p.item);
      continue;
    }
    const message = result.result.message;
    await logUsage({ stage: "draft", ...ctx, prospectId: p.item.prospect.id, emailId: p.emailId }, env().MODEL_DRAFT, usageFromApi(message.usage), { batch: true });
    try {
      const draft = parseDraftMessage(message, p.item.day);
      const checks = applyGuardrails(draft, p.input, allow);
      await db
        .update(schema.emails)
        .set({
          subject: draft.subject,
          body: draft.body,
          rationale: draft.rationale,
          proofPoints: draft.proofPointsUsed,
          guardrailWarnings: checks.warnings,
          error: checks.errors.length ? checks.errors.join("; ") : null,
          templateVersion: templates.version,
          status: "pending_review",
          updatedAt: new Date(),
        })
        .where(eq(schema.emails.id, p.emailId));
      done++;
    } catch (err) {
      console.error(`[morning] batch draft unusable for ${p.emailId}: ${errorMessage(err)}`);
      leftovers.push(p.item);
    }
  }
  for (const p of byId.values()) leftovers.push(p.item); // missing from results
  return { done, leftovers };
}
