import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { mapLimit, errorMessage } from "@/lib/concurrency";
import { parseRows, type ParsedProspect } from "@/services/ingest/parse";
import { classifyCompanies } from "@/services/research/classify";
import { ensureIndustryBrief } from "@/services/research/industry";
import { ensureCompanyResearch, type CompanyRecord } from "@/services/research/company";
import { ensurePersonResearch } from "@/services/research/person";
import type { IndustryBrief } from "@/services/research/types";
import { applyGuardrails, draftEmail } from "@/services/drafting/draft";
import { getActiveTemplates } from "@/services/drafting/templates";
import { DEFAULT_TIMEZONE, localDate } from "./calendar";
import { getAppSettings, loadDraftInput } from "./context";

const ACTIVE_STATUSES = ["researching", "active"] as const;
const RESEARCH_CONCURRENCY = 3;
const DRAFT_CONCURRENCY = 3;

/** Emails already in someone's active cadence -> owner email (so we never double-sequence a person). */
async function activeEmailOwners(emails: string[]): Promise<Map<string, string>> {
  if (!emails.length) return new Map();
  const rows = await db
    .select({ email: schema.prospects.email, owner: schema.users.email })
    .from(schema.prospects)
    .innerJoin(schema.users, eq(schema.users.id, schema.prospects.userId))
    .where(and(inArray(schema.prospects.email, emails), inArray(schema.prospects.status, [...ACTIVE_STATUSES])));
  return new Map(rows.map((r) => [r.email, r.owner]));
}

export type IngestResult = { uploadId: string; ready: number; skipped: schema.SkippedRow[] };

/** Validates rows and stores the upload + prospects. No model calls happen here. */
export async function ingestUpload(userId: string, source: string, rows: string[][], day1SendAt: Date): Promise<IngestResult> {
  const emails = rows.slice(1).flatMap((r) => r.map((c) => String(c).trim().toLowerCase()).filter((c) => c.includes("@")));
  const { prospects, skipped } = parseRows(rows, { activeEmails: await activeEmailOwners(emails) });

  return db.transaction(async (tx) => {
    const [upload] = await tx
      .insert(schema.uploads)
      .values({ userId, source, day1SendAt, totalRows: prospects.length + skipped.length, readyRows: prospects.length, skippedRows: skipped })
      .returning();
    if (prospects.length) {
      await tx.insert(schema.prospects).values(
        prospects.map((p: ParsedProspect) => ({
          userId,
          uploadId: upload.id,
          name: p.name,
          title: p.title,
          companyName: p.companyName,
          companyKey: p.companyKey,
          linkedinUrl: p.linkedinUrl,
          email: p.email,
          personKey: p.personKey,
          callNotes: p.callNotes,
        })),
      );
    }
    return { uploadId: upload.id, ready: prospects.length, skipped };
  });
}

/**
 * Research + Day 1 drafting for an upload. Every research unit runs at most once:
 * industries per unique industry, companies per unique company, people per unique person.
 */
export async function runUploadPipeline(uploadId: string): Promise<void> {
  const [upload] = await db.select().from(schema.uploads).where(eq(schema.uploads.id, uploadId));
  if (!upload) throw new Error(`Upload ${uploadId} not found`);
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, upload.userId));
  const tz = user.settings.timezone ?? DEFAULT_TIMEZONE;

  const [run] = await db
    .insert(schema.dailyRuns)
    .values({ userId: upload.userId, runDate: localDate(new Date(), tz), kind: "upload", uploadId })
    .returning();
  const ctx = { runId: run.id, userId: upload.userId };
  const stats: Record<string, number> = { prospects: 0, companies: 0, industries: 0, drafted: 0, failed: 0 };

  try {
    await db.update(schema.uploads).set({ status: "researching" }).where(eq(schema.uploads.id, uploadId));
    const prospects = await db.select().from(schema.prospects).where(eq(schema.prospects.uploadId, uploadId));
    stats.prospects = prospects.length;

    // 1. Classify only companies we have never classified.
    const byCompany = new Map<string, { name: string; titles: string[] }>();
    for (const p of prospects) {
      const entry = byCompany.get(p.companyKey) ?? { name: p.companyName, titles: [] };
      if (p.title) entry.titles.push(p.title);
      byCompany.set(p.companyKey, entry);
    }
    stats.companies = byCompany.size;
    const known = await db.select().from(schema.companies).where(inArray(schema.companies.key, [...byCompany.keys()]));
    const knownKeys = new Set(known.filter((c) => c.industryKey).map((c) => c.key));
    const toClassify = [...byCompany].filter(([k]) => !knownKeys.has(k)).map(([key, v]) => ({ key, name: v.name, titles: v.titles }));
    const classified = toClassify.length ? await classifyCompanies(ctx, toClassify) : new Map();
    for (const [key, c] of classified) {
      const values = { key, displayName: byCompany.get(key)!.name, industryKey: c.industryKey, classifyConfidence: { high: "0.9", medium: "0.6", low: "0.3" }[c.confidence as "high"] };
      await db.insert(schema.companies).values(values).onConflictDoUpdate({ target: schema.companies.key, set: { industryKey: values.industryKey, classifyConfidence: values.classifyConfidence } });
    }
    const industryOf = new Map<string, string>([
      ...known.filter((c) => c.industryKey).map((c) => [c.key, c.industryKey!] as [string, string]),
      ...[...classified].map(([k, c]) => [k, c.industryKey] as [string, string]),
    ]);

    // 2. One brief per unique industry.
    const uniqueIndustries = [...new Set(industryOf.values())];
    stats.industries = uniqueIndustries.length;
    const briefs = new Map<string, IndustryBrief>();
    const briefResults = await mapLimit(uniqueIndustries, RESEARCH_CONCURRENCY, (key) => ensureIndustryBrief(ctx, key));
    briefResults.forEach((r, i) => {
      if (r.status === "fulfilled") briefs.set(uniqueIndustries[i], r.value);
      else console.error(`[upload ${uploadId}] industry ${uniqueIndustries[i]} failed: ${errorMessage(r.reason)}`);
    });

    // 3. One research pass per unique company.
    const companies = new Map<string, CompanyRecord>();
    const companyKeys = [...byCompany.keys()];
    const companyResults = await mapLimit(companyKeys, RESEARCH_CONCURRENCY, (key) => {
      const industryKey = industryOf.get(key) ?? "manufacturing/general";
      return ensureCompanyResearch(ctx, { key, displayName: byCompany.get(key)!.name, industryKey }, briefs.get(industryKey) ?? null, byCompany.get(key)!.titles);
    });
    companyResults.forEach((r, i) => {
      if (r.status === "fulfilled") companies.set(companyKeys[i], r.value);
      else console.error(`[upload ${uploadId}] company ${companyKeys[i]} failed: ${errorMessage(r.reason)}`);
    });
    // Company research may correct an industry; make sure that brief exists too (cached if already there).
    const corrected = [...new Set([...companies.values()].map((c) => c.industryKey))].filter((k) => !briefs.has(k));
    await mapLimit(corrected, RESEARCH_CONCURRENCY, async (key) => briefs.set(key, await ensureIndustryBrief(ctx, key)));

    // 4. One research pass per unique person.
    const uniquePeople = [...new Map(prospects.map((p) => [p.personKey, p])).values()].filter((p) => companies.has(p.companyKey));
    await mapLimit(uniquePeople, RESEARCH_CONCURRENCY, (p) =>
      ensurePersonResearch(
        { ...ctx, prospectId: p.id },
        { personKey: p.personKey, name: p.name, title: p.title, linkedinUrl: p.linkedinUrl },
        companies.get(p.companyKey)!,
      ),
    );

    // 5. Day 1 drafts, grouped by industry so the cached prompt prefix is reused.
    const templates = await getActiveTemplates();
    const allow = (await getAppSettings()).referenceableClients ?? [];
    const dueDate = localDate(upload.day1SendAt ?? new Date(), tz);
    const ordered = [...prospects].sort((a, b) =>
      (companies.get(a.companyKey)?.industryKey ?? "").localeCompare(companies.get(b.companyKey)?.industryKey ?? ""),
    );
    const draftResults = await mapLimit(ordered, DRAFT_CONCURRENCY, (p) => draftAndStore({ ...ctx, prospectId: p.id }, p, 1, dueDate, templates, allow));
    stats.drafted = draftResults.filter((r) => r.status === "fulfilled").length;
    stats.failed = draftResults.length - stats.drafted;

    await db.update(schema.uploads).set({ status: "drafted" }).where(eq(schema.uploads.id, uploadId));
    await db.update(schema.dailyRuns).set({ status: "done", stats, finishedAt: new Date() }).where(eq(schema.dailyRuns.id, run.id));
  } catch (err) {
    const message = errorMessage(err);
    await db.update(schema.uploads).set({ status: "failed", error: message }).where(eq(schema.uploads.id, uploadId));
    await db.update(schema.dailyRuns).set({ status: "failed", error: message, stats, finishedAt: new Date() }).where(eq(schema.dailyRuns.id, run.id));
    throw err;
  }
}

/** Drafts one email synchronously and stores it as pending review (or failed, visible to the SDR with a retry). */
export async function draftAndStore(
  ctx: { runId?: string | null; userId: string; prospectId: string },
  prospect: typeof schema.prospects.$inferSelect,
  day: 1 | 4 | 7 | 12,
  dueDate: string,
  templates: Awaited<ReturnType<typeof getActiveTemplates>>,
  allowlist: string[],
  regenerateInstruction?: string | null,
): Promise<string> {
  const [row] = await db
    .insert(schema.emails)
    .values({ prospectId: prospect.id, userId: prospect.userId, day, dueDate, status: "generating" })
    .onConflictDoUpdate({
      target: [schema.emails.prospectId, schema.emails.day],
      set: { status: "generating", error: null, updatedAt: new Date() },
    })
    .returning();
  try {
    const input = await loadDraftInput({ ...ctx, emailId: row.id }, prospect, day);
    input.regenerateInstruction = regenerateInstruction ?? null;
    const draft = await draftEmail({ ...ctx, emailId: row.id }, input, templates);
    const checks = applyGuardrails(draft, input, allowlist);
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
      .where(eq(schema.emails.id, row.id));
    if (prospect.status === "researching") {
      await db.update(schema.prospects).set({ status: "active" }).where(eq(schema.prospects.id, prospect.id));
    }
    return row.id;
  } catch (err) {
    await db
      .update(schema.emails)
      .set({ status: "failed", error: errorMessage(err), updatedAt: new Date() })
      .where(eq(schema.emails.id, row.id));
    throw err;
  }
}
