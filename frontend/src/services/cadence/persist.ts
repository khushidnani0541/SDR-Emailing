import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { applyGuardrails, pickAttachment, type Draft, type DraftInput } from "@/services/drafting/draft";
import { fillStatic, type ActiveTemplates } from "@/services/drafting/templates";
import { checkEmail } from "@/services/drafting/guardrails";
import { attachmentsConfigured, resolveAttachmentUrl } from "@/services/attachments/case-studies";
import type { EmailDay } from "./calendar";

/** Org settings the drafting step needs. */
export type DraftOrgSettings = Pick<schema.AppSettings, "referenceableClients" | "caseStudyFiles">;

export function attachmentsEnabled(org: DraftOrgSettings): boolean {
  return attachmentsConfigured(org.caseStudyFiles);
}

/** Saves a model-drafted email: picks its case study, runs guardrails and puts it into review. */
export async function persistDraft(emailId: string, draft: Draft, input: DraftInput, templates: ActiveTemplates, org: DraftOrgSettings) {
  const attachment = pickAttachment(draft, input, (id) => resolveAttachmentUrl(org.caseStudyFiles, id));
  const checks = applyGuardrails(draft, input, org.referenceableClients ?? [], attachment);
  await db
    .update(schema.emails)
    .set({
      subject: draft.subject,
      body: draft.body,
      rationale: draft.rationale,
      proofPoints: draft.proofPointsUsed,
      attachment,
      guardrailWarnings: checks.warnings,
      error: checks.errors.length ? checks.errors.join("; ") : null,
      templateVersion: templates.version,
      status: "pending_review",
      updatedAt: new Date(),
    })
    .where(eq(schema.emails.id, emailId));
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/**
 * Fixed-copy days (e.g. the Day 12 break-up email) need only the name and company, so they are
 * filled without any research or model call. Returns false when the day needs the model.
 */
export async function persistStaticIfPossible(
  emailId: string,
  prospect: { name: string; companyName: string },
  day: EmailDay,
  templates: ActiveTemplates,
): Promise<boolean> {
  if (day === 1) return false; // Day 1 needs a subject line written for the prospect
  const body = fillStatic(templates.byDay[day], { firstName: firstName(prospect.name), company: prospect.companyName });
  if (!body) return false;
  const checks = checkEmail({ day, subject: null, body, knownClients: [], referenceableClients: [] });
  await db
    .update(schema.emails)
    .set({
      subject: null,
      body,
      rationale: "Fixed template copy (no research or AI call needed)",
      proofPoints: [],
      attachment: null,
      guardrailWarnings: checks.warnings,
      error: checks.errors.length ? checks.errors.join("; ") : null,
      templateVersion: templates.version,
      status: "pending_review",
      updatedAt: new Date(),
    })
    .where(eq(schema.emails.id, emailId));
  return true;
}
