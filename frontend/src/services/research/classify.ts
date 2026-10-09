import { env } from "@/lib/env";
import { runJson, type CallCtx } from "@/services/llm/tracked";
import { INDUSTRIES } from "./taxonomy";
import { ClassificationSchema } from "./types";

export type CompanyToClassify = { key: string; name: string; titles: string[] };
export type Classification = { industryKey: string; confidence: "high" | "medium" | "low" };

const CHUNK = 40;

const TAXONOMY_TEXT = INDUSTRIES.map((i) => `- ${i.key}: ${i.label} (${i.examples})`).join("\n");

const SYSTEM = `You classify companies into a fixed industry taxonomy for a B2B industrial IoT seller.
Pick the single best industryKey for each company based on what the company primarily operates (its plants/assets), using your own knowledge.
Use confidence "low" when you do not recognise the company or the name is ambiguous; it will be verified later with web research.

Taxonomy:
${TAXONOMY_TEXT}`;

/**
 * Batched, no-web classification with the cheap model. One call per 40 companies.
 * Only companies not already classified are passed in by the pipeline.
 */
export async function classifyCompanies(
  ctx: Omit<CallCtx, "stage">,
  companies: CompanyToClassify[],
): Promise<Map<string, Classification>> {
  const out = new Map<string, Classification>();
  for (let i = 0; i < companies.length; i += CHUNK) {
    const chunk = companies.slice(i, i + CHUNK);
    const list = chunk
      .map((c) => `- key: ${c.key} | company: ${c.name}${c.titles.length ? ` | contacts: ${c.titles.slice(0, 3).join("; ")}` : ""}`)
      .join("\n");
    const { data } = await runJson(
      { ...ctx, stage: "classify" },
      {
        model: env().MODEL_CLASSIFY,
        max_tokens: 200 + chunk.length * 60,
        system: SYSTEM,
        messages: [{ role: "user", content: `Classify these companies. Return every key exactly as given.\n${list}` }],
      },
      ClassificationSchema,
    );
    for (const c of data.companies) out.set(c.key, { industryKey: c.industryKey, confidence: c.confidence });
    // Anything the model skipped falls back to manufacturing/general with low confidence.
    for (const c of chunk) if (!out.has(c.key)) out.set(c.key, { industryKey: "manufacturing/general", confidence: "low" });
  }
  return out;
}
