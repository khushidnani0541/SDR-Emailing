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
};

const RULES = `You write cold outbound emails for a Faclon SDR, in the voice of an experienced, credible account executive.
Writing rules:
- Plain, specific, human. No hype words (revolutionise, cutting-edge, synergy), no exclamation marks, no emojis, no bullet lists.
- Personalise from the research: their plant/equipment, a recent company signal, their role's likely priority, or a public mention. Never mention anything personal or anything you are not confident about; if identity confidence is low, personalise at company/role level only.
- Use only proof points from the industry brief. Never mention Faclon pricing or commercial terms. Name a client only if it is listed as referenceable; otherwise anonymise ("a leading cement producer").
- Follow-ups (Day 4, 7, 12) are replies in the Day 1 thread: subject must be null, do not re-introduce Faclon, and never repeat an angle or proof point already used in previous emails.
- Use the prospect's first name in the greeting. End with a short sign-off line (e.g. "Best,") but no name or signature - the system appends the SDR's signature.
- Follow the day's template guidelines below for goal, structure and length.`;

function systemBlocks(templates: ActiveTemplates): Anthropic.TextBlockParam[] {
  const templateText = EMAIL_DAYS.map((d) => `### Day ${d} email guidelines\n${templates.byDay[d]}`).join("\n\n");
  // Stable across all prospects and days -> cached prefix.
  return [{ type: "text", text: `${FACLON_CONTEXT}\n\n${RULES}\n\n## Cadence templates\n${templateText}`, cache_control: { type: "ephemeral" } }];
}

/** Builds a cache-friendly request: system (stable) -> industry brief (shared per industry) -> prospect specifics. */
export function buildDraftRequest(input: DraftInput, templates: ActiveTemplates): Anthropic.MessageCreateParamsNonStreaming {
  const industryBlock = input.brief
    ? `## Industry brief (${input.industryKey})\n${briefForPrompt(input.brief)}`
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

export function applyGuardrails(
  draft: Draft,
  input: DraftInput,
  referenceableClients: string[],
): GuardrailResult {
  return checkEmail({
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
