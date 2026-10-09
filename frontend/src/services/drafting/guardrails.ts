// Checks every drafted email before it reaches the review queue.
// "errors" block approval until fixed; "warnings" are shown to the SDR.

export type GuardrailInput = {
  day: number;
  subject: string | null;
  body: string;
  /** Client names from the industry brief; any that appear must be in the allowlist (if one is configured). */
  knownClients: string[];
  referenceableClients: string[];
  identityConfidence?: "high" | "medium" | "low";
};

export type GuardrailResult = { errors: string[]; warnings: string[] };

const WORD_LIMITS: Record<number, number> = { 1: 160, 4: 130, 7: 120, 12: 100 };

const PLACEHOLDER_RE = /\{\{[^}]*\}\}|\[(first\s*name|name|company|title|your name|insert[^\]]*)\]|<[^>]*(name|company)[^>]*>|\bTODO\b|\bTBD\b|\bXX+\b/i;
// Commercial/pricing language: Faclon's own pricing is confidential and never belongs in cold email.
const PRICING_RE = /\b(pric(e|es|ing)|quote|quotation|discount|licen[cs]e fee|subscription fee|per (month|year|annum|user|device|asset|plant)|rate card|commercials?)\b/i;
const MONEY_RE = /(₹|\bRs\.?\s?\d|\bINR\s?\d|\$\s?\d|\bUSD\s?\d|\b\d[\d,.]*\s?(lakh|lac|crore|cr)\b)/i;

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function checkEmail(input: GuardrailInput): GuardrailResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const full = `${input.subject ?? ""}\n${input.body}`;

  if (!input.body.trim()) errors.push("Email body is empty");
  if (input.day === 1 && !input.subject?.trim()) errors.push("Day 1 email needs a subject line");
  if (PLACEHOLDER_RE.test(full)) errors.push("Contains an unfilled placeholder");
  if (PRICING_RE.test(full)) warnings.push("Mentions pricing/commercial terms - Faclon pricing must not appear in cold emails");
  if (MONEY_RE.test(full)) warnings.push("Contains a money figure - make sure it's a client result, not Faclon pricing");

  const limit = WORD_LIMITS[input.day] ?? 150;
  const words = wordCount(input.body);
  if (words > limit) warnings.push(`Long for a Day ${input.day} email (${words} words, aim for under ${limit})`);

  if (input.referenceableClients.length) {
    const allowed = input.referenceableClients.map((c) => c.toLowerCase());
    const named = input.knownClients.filter(
      (c) => c.length > 2 && full.toLowerCase().includes(c.toLowerCase()) && !allowed.some((a) => c.toLowerCase().includes(a) || a.includes(c.toLowerCase())),
    );
    if (named.length) warnings.push(`Names client(s) not on the referenceable list: ${[...new Set(named)].join(", ")}`);
  }

  if (input.identityConfidence === "low") {
    warnings.push("Person research has low identity confidence - double-check personal references");
  }
  return { errors, warnings };
}
