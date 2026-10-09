import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { errorMessage } from "@/lib/concurrency";
import { enqueue, QUEUES } from "@/worker/queue";
import { deleteDraft, upsertDraft } from "@/services/gmail/gmail";
import { replySubject, withSignature } from "@/services/gmail/mime";
import { checkEmail } from "@/services/drafting/guardrails";
import { CALL_DAYS, cadenceDate, DEFAULT_TIMEZONE, LINKEDIN_DAY, localDate, staggeredTimes, zonedTime } from "./calendar";
import { fetchAttachment } from "@/services/attachments/case-studies";

type User = typeof schema.users.$inferSelect;
type Prospect = typeof schema.prospects.$inferSelect;
type Email = typeof schema.emails.$inferSelect;

export const DEFAULT_SETTINGS = {
  timezone: DEFAULT_TIMEZONE,
  day1SendTime: "12:00", // Day 1: noon ET on the upload day
  defaultSendTime: "10:00", // Day 4/7/12: 10 AM ET
  spreadMinutes: 45,
  dailyCap: 150,
  morningRunTime: "07:00",
};

export function effectiveSettings(user: Pick<User, "settings">) {
  return { ...DEFAULT_SETTINGS, ...user.settings };
}

async function loadUser(userId: string): Promise<User> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) throw new Error("SDR not found");
  return user;
}

export type ApproveResult = { approved: number; failed: { emailId: string; error: string }[]; skipped: { emailId: string; reason: string }[] };

/**
 * Bulk approve: puts each email into the SDR's Gmail as a draft (follow-ups threaded under Day 1)
 * and schedules the send. Times are staggered across the SDR's spread window.
 */
export async function approveEmails(userId: string, emailIds: string[], sendTime: string, spreadMinutes?: number): Promise<ApproveResult> {
  const user = await loadUser(userId);
  if (!user.gmailConnected) throw new Error("Connect your Gmail before approving emails");
  const settings = effectiveSettings(user);
  const result: ApproveResult = { approved: 0, failed: [], skipped: [] };

  const rows = await db
    .select({ email: schema.emails, prospect: schema.prospects, day1SendAt: schema.uploads.day1SendAt })
    .from(schema.emails)
    .innerJoin(schema.prospects, eq(schema.prospects.id, schema.emails.prospectId))
    .innerJoin(schema.uploads, eq(schema.uploads.id, schema.prospects.uploadId))
    .where(and(eq(schema.emails.userId, userId), inArray(schema.emails.id, emailIds), eq(schema.emails.status, "pending_review")))
    .orderBy(asc(schema.emails.day), asc(schema.prospects.name));

  const eligible = rows.filter(({ email, prospect }) => {
    if (email.error) return !result.skipped.push({ emailId: email.id, reason: `Fix first: ${email.error}` });
    if (prospect.status !== "active") return !result.skipped.push({ emailId: email.id, reason: `Prospect is ${prospect.status}` });
    if (email.day !== 1 && !prospect.threadId) return !result.skipped.push({ emailId: email.id, reason: "Day 1 email has not been sent yet" });
    return true;
  });

  // Daily cap counts emails already scheduled/sent for the same local day.
  const today = localDate(new Date(), settings.timezone);
  const [{ count: alreadyToday }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.emails)
    .where(and(eq(schema.emails.userId, userId), eq(schema.emails.dueDate, today), inArray(schema.emails.status, ["approved", "sent"])));
  const room = Math.max(0, settings.dailyCap - alreadyToday);
  for (const { email } of eligible.slice(room)) result.skipped.push({ emailId: email.id, reason: `Daily cap of ${settings.dailyCap} reached` });
  const batch = eligible.slice(0, room);

  // Day 1 goes out at the time the SDR set at upload (if still ahead); everything else
  // uses today's trigger time from the review page. Each window is staggered separately.
  const soon = () => new Date(Date.now() + 2 * 60_000);
  let barStart = zonedTime(today, sendTime, settings.timezone);
  if (barStart.getTime() < Date.now() + 60_000) barStart = soon(); // time already passed -> send soon
  const windows = new Map<number, typeof batch>();
  for (const item of batch) {
    const planned = item.email.day === 1 && item.day1SendAt && item.day1SendAt.getTime() > Date.now() + 60_000 ? item.day1SendAt : barStart;
    windows.set(planned.getTime(), [...(windows.get(planned.getTime()) ?? []), item]);
  }

  for (const [startMs, items] of windows) {
    const times = staggeredTimes(new Date(startMs), items.length, spreadMinutes ?? settings.spreadMinutes);
    for (const [i, { email, prospect }] of items.entries()) {
      try {
        await scheduleOne(user, prospect, email, times[i], settings.signature);
        result.approved++;
      } catch (err) {
        result.failed.push({ emailId: email.id, error: errorMessage(err) });
      }
    }
  }
  return result;
}

async function scheduleOne(user: User, prospect: Prospect, email: Email, sendAt: Date, signature?: string) {
  const subject = email.day === 1 ? email.subject! : replySubject(prospect.lastSubject ?? "");
  // Case study chosen at drafting time; downloaded now so the Gmail draft carries the real file.
  const attachments = email.attachment?.url ? [await fetchAttachment(email.attachment.url, email.attachment.title)] : [];
  const { draftId } = await upsertDraft(
    user.id,
    {
      from: { name: user.name, email: user.email },
      to: { name: prospect.name, email: prospect.email },
      subject,
      body: withSignature(email.body ?? "", signature, user.name),
      inReplyTo: email.day === 1 ? null : prospect.rfcMessageId,
      attachments,
    },
    { threadId: email.day === 1 ? null : prospect.threadId, existingDraftId: email.gmailDraftId },
  );
  await db
    .update(schema.emails)
    .set({ status: "approved", scheduledFor: sendAt, gmailDraftId: draftId, error: null, updatedAt: new Date() })
    .where(eq(schema.emails.id, email.id));
  await enqueue(QUEUES.sendEmail, { emailId: email.id }, { startAfter: sendAt, singletonKey: `send:${email.id}:${sendAt.getTime()}` });

  if (email.day === 1) {
    // Day 1 date anchors the rest of the cadence; create the SDR's call tasks (Day 1 call already
    // happened) and the Day 6 LinkedIn connection request.
    const settings = effectiveSettings(user);
    const day1 = localDate(sendAt, settings.timezone);
    await db.update(schema.prospects).set({ day1Date: day1, lastSubject: subject }).where(eq(schema.prospects.id, prospect.id));
    await db
      .insert(schema.callTasks)
      .values(
        [
          ...CALL_DAYS.map((day) => ({
            prospectId: prospect.id,
            userId: user.id,
            day,
            kind: "call",
            dueDate: cadenceDate(day1, day, settings.holidays ?? []),
            status: day === 1 ? ("done" as const) : ("pending" as const),
          })),
          {
            prospectId: prospect.id,
            userId: user.id,
            day: LINKEDIN_DAY,
            kind: "linkedin",
            dueDate: cadenceDate(day1, LINKEDIN_DAY, settings.holidays ?? []),
            status: "pending" as const,
          },
        ],
      )
      .onConflictDoNothing();
  }
}

export async function rejectEmail(userId: string, emailId: string, mode: "skip" | "stop"): Promise<void> {
  const [email] = await db.select().from(schema.emails).where(and(eq(schema.emails.id, emailId), eq(schema.emails.userId, userId)));
  if (!email) throw new Error("Email not found");
  if (email.status === "sent") throw new Error("This email was already sent");
  if (email.gmailDraftId) await deleteDraft(userId, email.gmailDraftId);
  await db.update(schema.emails).set({ status: "rejected", updatedAt: new Date() }).where(eq(schema.emails.id, emailId));
  if (mode === "stop") await stopProspect(userId, email.prospectId, "stopped", "Rejected by SDR");
}

export async function editEmail(userId: string, emailId: string, subject: string | null, body: string): Promise<void> {
  const [row] = await db
    .select({ email: schema.emails, prospect: schema.prospects })
    .from(schema.emails)
    .innerJoin(schema.prospects, eq(schema.prospects.id, schema.emails.prospectId))
    .where(and(eq(schema.emails.id, emailId), eq(schema.emails.userId, userId)));
  if (!row) throw new Error("Email not found");
  if (!["pending_review", "failed"].includes(row.email.status)) throw new Error("Only emails awaiting review can be edited here; edit scheduled ones in Gmail drafts");
  const checks = checkEmail({
    day: row.email.day,
    subject: row.email.day === 1 ? subject : null,
    body,
    knownClients: [],
    referenceableClients: [],
    hasAttachment: !!row.email.attachment?.url,
  });
  await db
    .update(schema.emails)
    .set({
      subject: row.email.day === 1 ? subject : null,
      body,
      status: "pending_review",
      error: checks.errors.length ? checks.errors.join("; ") : null,
      guardrailWarnings: checks.warnings,
      updatedAt: new Date(),
    })
    .where(eq(schema.emails.id, emailId));
}

/** Stops a prospect's cadence: cancels any not-yet-sent emails and removes their Gmail drafts. */
export async function stopProspect(
  userId: string,
  prospectId: string,
  status: "replied" | "bounced" | "meeting_booked" | "not_interested" | "stopped" | "completed",
  reason: string,
): Promise<void> {
  const pending = await db
    .select()
    .from(schema.emails)
    .where(and(eq(schema.emails.prospectId, prospectId), inArray(schema.emails.status, ["generating", "pending_review", "approved"])));
  for (const e of pending) {
    if (e.gmailDraftId) {
      try {
        await deleteDraft(userId, e.gmailDraftId);
      } catch (err) {
        console.error(`[stop] could not delete draft ${e.gmailDraftId}`, err);
      }
    }
  }
  if (pending.length) {
    await db.update(schema.emails).set({ status: "cancelled", updatedAt: new Date() }).where(inArray(schema.emails.id, pending.map((e) => e.id)));
  }
  await db.update(schema.prospects).set({ status, stopReason: reason }).where(eq(schema.prospects.id, prospectId));
  if (status !== "completed") {
    await db
      .update(schema.callTasks)
      .set({ status: "done", outcome: "cadence_stopped", updatedAt: new Date() })
      .where(and(eq(schema.callTasks.prospectId, prospectId), eq(schema.callTasks.status, "pending")));
  }
}

export const CALL_OUTCOMES = ["no_answer", "connected", "meeting_booked", "not_interested", "wrong_person", "linkedin_sent", "linkedin_skipped"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export async function logCallOutcome(userId: string, callTaskId: string, outcome: CallOutcome, notes: string | null): Promise<void> {
  const [task] = await db.select().from(schema.callTasks).where(and(eq(schema.callTasks.id, callTaskId), eq(schema.callTasks.userId, userId)));
  if (!task) throw new Error("Call task not found");
  await db.update(schema.callTasks).set({ status: "done", outcome, notes, updatedAt: new Date() }).where(eq(schema.callTasks.id, callTaskId));
  if (notes) {
    // Call notes feed the next email draft.
    await db
      .update(schema.prospects)
      .set({ callNotes: sql`coalesce(${schema.prospects.callNotes} || E'\n', '') || ${`Day ${task.day} ${task.kind === "linkedin" ? "LinkedIn" : "call"}: ${notes}`}` })
      .where(eq(schema.prospects.id, task.prospectId));
  }
  if (outcome === "meeting_booked" || outcome === "not_interested" || outcome === "wrong_person") {
    await stopProspect(userId, task.prospectId, outcome === "wrong_person" ? "stopped" : outcome, `Call outcome: ${outcome}`);
  }
}

/** "Send tomorrow" for expired emails: moves them back into review for today. */
export async function reviveExpired(userId: string, emailIds: string[]): Promise<number> {
  const user = await loadUser(userId);
  const today = localDate(new Date(), effectiveSettings(user).timezone);
  const rows = await db
    .update(schema.emails)
    .set({ status: "pending_review", dueDate: today, updatedAt: new Date() })
    .where(and(eq(schema.emails.userId, userId), inArray(schema.emails.id, emailIds), eq(schema.emails.status, "expired")))
    .returning({ id: schema.emails.id });
  return rows.length;
}

