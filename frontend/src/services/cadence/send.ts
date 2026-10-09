import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { checkThread, sendDraft } from "@/services/gmail/gmail";
import { stopProspect } from "./actions";

export type SendOutcome = "sent" | "skipped" | "draft_only" | "cancelled" | "stopped";

/** Worker job: sends one approved email at its scheduled time. Safe to retry. */
export async function sendScheduledEmail(emailId: string): Promise<SendOutcome> {
  const [row] = await db
    .select({ email: schema.emails, prospect: schema.prospects, user: schema.users })
    .from(schema.emails)
    .innerJoin(schema.prospects, eq(schema.prospects.id, schema.emails.prospectId))
    .innerJoin(schema.users, eq(schema.users.id, schema.emails.userId))
    .where(eq(schema.emails.id, emailId));
  if (!row || row.email.status !== "approved" || !row.email.gmailDraftId) return "skipped";
  const { email, prospect, user } = row;

  // A stale job (e.g. the SDR re-approved with a new time) must not send early.
  if (email.scheduledFor && email.scheduledFor.getTime() > Date.now() + 60_000) return "skipped";

  if (prospect.status !== "active") {
    await db
      .update(schema.emails)
      .set({ status: "cancelled", error: `Prospect is ${prospect.status}`, updatedAt: new Date() })
      .where(eq(schema.emails.id, email.id));
    return "cancelled";
  }

  // Last-moment reply/bounce check on the Day 1 thread.
  if (email.day !== 1 && prospect.threadId) {
    const thread = await checkThread(user.id, user.email, prospect.threadId);
    if (thread !== "none") {
      await stopProspect(user.id, prospect.id, thread, thread === "replied" ? "Prospect replied" : "Email bounced");
      return "stopped";
    }
  }

  if (env().SEND_MODE === "draft_only" || user.settings.draftOnly) {
    await db
      .update(schema.emails)
      .set({ error: "Draft-only mode: left in Gmail drafts, not sent", updatedAt: new Date() })
      .where(eq(schema.emails.id, email.id));
    return "draft_only";
  }

  const result = await sendDraft(user.id, email.gmailDraftId!);
  if (!result.ok) {
    await db.update(schema.emails).set({ status: "cancelled", error: "Draft was deleted in Gmail", updatedAt: new Date() }).where(eq(schema.emails.id, email.id));
    return "cancelled";
  }

  await db
    .update(schema.emails)
    .set({ status: "sent", sentAt: new Date(), gmailMessageId: result.messageId, error: null, updatedAt: new Date() })
    .where(and(eq(schema.emails.id, email.id), eq(schema.emails.status, "approved")));

  if (email.day === 1) {
    await db
      .update(schema.prospects)
      .set({ threadId: result.threadId, rfcMessageId: result.rfcMessageId })
      .where(eq(schema.prospects.id, prospect.id));
  }
  if (email.day === 12) {
    await db.update(schema.prospects).set({ status: "completed", stopReason: "Cadence completed" }).where(eq(schema.prospects.id, prospect.id));
  }
  return "sent";
}
