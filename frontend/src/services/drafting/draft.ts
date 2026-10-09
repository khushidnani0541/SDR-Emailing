import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "@/lib/env";
import { extractJson, finalText, runJson, type CallCtx } from "@/services/llm/tracked";
import { FACLON_CONTEXT } from "@/services/research/faclon-context";
import { briefForPrompt } from "@/services/research/industry";
import { companyForPrompt, type CompanyRecord } from "@/services/research/company";
import { personForPrompt } from "@/services/research/person";
import type { IndustryBrief, PersonResearch } from "@/services/research/types";
import { EMAIL_DAYS, type EmailDay } from "@/services/cadence/calendar";
import type { ActiveTemplates } from "./templates";
import { checkEmail, type GuardrailResult } from "./guardrails";

export const DraftSchema = z.object({
  subject: z.string().nullable().describe("Day 1 only; null for follow-ups (they reply in the Day 1 thread)"),
  body: z.string().describe("Plain text. Greeting through sign-off line, WITHOUT the signature block"),
  rationale: z.string().describe("One sentence for the SDR: why this angle for this person"),
  proofPointsUsed: z.array(z.string()),
  caseStudyDocId: z.string().nullable().describe("Day 4 only: id of the collateral item that backs the example, from the industry brief's collateral list; null otherwise"),
});
export type Draft = z.infer<typeof DraftSchema>;

export type DraftInput = {
  day: EmailDay;
  prospect: { name: string; title: string | null; companyName: string; callNotes: string | null };
  industryKey: string;
  brief: IndustryBrief | null;
  company: CompanyRecord;
  person: PersonResearch | null;
  previousEmails: { day: number; subject: string | null; body: string }[];
  regenerateInstruction?: string | null;
  /** True when case-study files can be attached (Settings -> Case study files). */
  attachmentsEnabled?: boolean;
};

const RULES = `You fill in cold outbound emails for a Faclon SDR. The cadence templates below are the sales team's approved scripts.
How to use the template for the requested day:
- Keep the template's wording, order and length. Replace every {{placeholder}} with something specific from the research; you may lightly adjust the words around a placeholder so the sentence reads naturally. The output must never contain "{{" or "}}".
- {{Relevant Companies}}: 1-3 referenceable Faclon clients from the industry brief that are closest to the prospect's industry. If none are referenceable, use a short anonymised description (e.g. "leading cement and steel manufacturers").
- {{industry}}, {{production / quality / maintenance}}, {{X% improvement / X% reduction}}: take one real result from the industry brief's proof points, as close to the prospect's operations as possible. Never invent numbers; if no quantified result fits, describe the outcome qualitatively.
- {{specific plant / process / equipment ...}} and similar: use concrete facts from the company research (plants, equipment, processes, recent signals). If the research is thin, stay general rather than guess.
- Day 4 case study: choose the collateral item (case study preferred, else deck/one-pager) that best backs the example and return its id in caseStudyDocId. If the request says attachments are ON, keep "The case study is attached." If they are OFF, say you are happy to send it over instead - never claim an attachment.
- Day 1 assumes the first call was not answered. If the SDR call notes say they spoke, replace the opening line with a short reference to that conversation.
- Follow-ups (Day 4, 7, 12) are replies in the Day 1 thread: subject must be null.
- Subject (Day 1 only): 2-5 words, specific to their company or operations, no clickbait.
- End with the template's sign-off line (e.g. "Best,") and NO name - the system appends the SDR's signature.
- Never mention Faclon pricing or commercial terms, and nothing personal about the prospect beyond their professional role. Only use emojis that the template itself contains.`;

function systemBlocks(templates: ActiveTemplates): Anthropic.TextBlockParam[] {
  const templateText = EMAIL_DAYS.map((d) => `### Day ${d} email guidelines\n${templates.byDay[d]}`).join("\n\n");
  // Stable across all prospects and days -> cached prefix.
  return [{ type: "text", text: `${FACLON_CONTEXT}\n\n${RULES}\n\n## Cadence templates\n${templateText}`, cache_control: { type: "ephemeral" } }];
}

/** Builds a cache-friendly request: system (stable) -> industry brief (shared per industry) -> prospect specifics. */
export function buildDraftRequest(input: DraftInput, templates: ActiveTemplates): Anthropic.MessageCreateParamsNonStreaming {
  const collateral = input.brief?.collateral.length
    ? `\nCollateral (id | type | title | use for):\n${input.brief.collateral.map((c) => `- ${c.docId} | ${c.type} | ${c.title} | ${c.useFor}`).join("\n")}`
    : "";
  const industryBlock = input.brief
    ? `## Industry brief (${input.industryKey})\n${briefForPrompt(input.brief)}${collateral}`
    : `## Industry brief (${input.industryKey})\nNot available - keep proof points generic and conservative.`;

  const previous = input.previousEmails.length
    ? input.previousEmails.map((e) => `--- Day ${e.day}${e.subject ? ` (subject: ${e.subject})` : ""} ---\n${e.body}`).join("\n\n")
    : "None (this is the first email).";

  const specifics =
    `## Prospect\n${input.prospect.name}, ${input.prospect.title ?? "title unknown"} at ${input.prospect.companyName}\n` +
    (input.prospect.callNotes ? `SDR call notes: ${input.prospect.callNotes}\n` : "SDR call notes: none (assume the first call did not connect)\n") +
    `\n## Company research\n${companyForPrompt(input.company)}\n` +
    `\n## Person research\n${input.person ? personForPrompt(input.person) : "Not available - personalise at company/role level."}\n` +
    `\n## Previous emails in this thread\n${previous}\n` +
    (input.day === 4 ? `\nAttachments: ${input.attachmentsEnabled ? "ON" : "OFF"}\n` : "") +
    `\nWrite the Day ${input.day} email.` +
    (input.regenerateInstruction ? `\nSDR instruction for this rewrite: ${input.regenerateInstruction}` : "");

  return {
    model: env().MODEL_DRAFT,
    max_tokens: 4000,
    output_config: { effort: "low" },
    system: systemBlocks(templates),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: industryBlock, cache_control: { type: "ephemeral" } },
          { type: "text", text: specifics },
        ],
      },
    ],
  };
}

/** The case study the draft relies on, with its file URL when one is configured. */
export function pickAttachment(
  draft: Draft,
  input: DraftInput,
  resolveUrl: (docId: string) => string | null,
): { docId: string; title: string; url: string | null } | null {
  if (input.day !== 4 || !draft.caseStudyDocId) return null;
  const doc = input.brief?.collateral.find((c) => c.docId === draft.caseStudyDocId);
  if (!doc) return null; // ignore ids that aren't in the brief
  return { docId: doc.docId, title: doc.title, url: resolveUrl(doc.docId) };
}

export function applyGuardrails(
  draft: Draft,
  input: DraftInput,
  referenceableClients: string[],
  attachment: { url: string | null } | null = null,
): GuardrailResult {
  return checkEmail({
    hasAttachment: !!attachment?.url,
    day: input.day,
    subject: draft.subject,
    body: draft.body,
    knownClients: input.brief?.relevantClients.map((c) => c.name) ?? [],
    referenceableClients,
    identityConfidence: input.person?.identityConfidence,
  });
}

/** Synchronous draft (Day 1 at upload, regenerations). The morning run uses the Batch API instead. */
export async function draftEmail(ctx: Omit<CallCtx, "stage">, input: DraftInput, templates: ActiveTemplates): Promise<Draft> {
  const { data } = await runJson({ ...ctx, stage: "draft" }, buildDraftRequest(input, templates), DraftSchema);
  return normalizeDraft(data, input.day);
}

/** Parses a batch result message into a Draft. */
export function parseDraftMessage(message: Anthropic.Message, day: EmailDay): Draft {
  const parsed = DraftSchema.safeParse(extractJson(finalText(message)));
  if (!parsed.success) throw new Error("Draft output failed validation");
  return normalizeDraft(parsed.data, day);
}

function normalizeDraft(d: Draft, day: EmailDay): Draft {
  return { ...d, subject: day === 1 ? (d.subject?.trim() ?? "") : null, body: d.body.trim() };
}
