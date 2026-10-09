import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { librarian } from "@/services/librarian/client";
import { runJson, type CallCtx } from "@/services/llm/tracked";
import { FACLON_CONTEXT } from "./faclon-context";
import { industryDef, type IndustryDef } from "./taxonomy";
import { IndustryBriefSchema, type IndustryBrief } from "./types";
import { isFresh, recordCacheHit, singleFlight, TTL_DAYS } from "./cache";

const MAX_RETRIEVAL_CHARS = 28_000; // ~7k tokens of collateral context per industry

/** Keeps unique "- [doc-id] ..." entries across several list_documents outputs. */
export function mergeListings(listings: string[], maxChars: number): string {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const listing of listings) {
    for (const entry of listing.split(/\n(?=- \[)/)) {
      const id = entry.match(/^- \[([^\]]+)\]/)?.[1];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      entries.push(entry.trim());
    }
  }
  let out = "";
  for (const e of entries) {
    if (out.length + e.length > maxChars) break;
    out += `${e}\n`;
  }
  return out;
}

/** Deterministic Librarian retrieval. No model calls; ~4-6 HTTP requests per industry. */
async function retrieveCollateral(def: IndustryDef): Promise<{ answer: string; listings: string }> {
  const isSubVertical = def.key.includes("/") && def.key !== "manufacturing/general";
  const question =
    `For the ${def.label} industry (${def.examples}): which use cases has Faclon delivered or proposed, ` +
    `what measurable results were achieved (with numbers), and for which clients? ` +
    `Clearly separate delivered deployments and POCs from proposals or scoping documents. Do not include pricing.`;

  const listCalls: Promise<string>[] = [];
  for (const industry of def.librarianIndustries) {
    if (isSubVertical) {
      for (const query of def.keywords.slice(0, 2)) {
        listCalls.push(librarian.listDocuments({ industry, query, verbose: true, limit: 12 }));
      }
    } else {
      listCalls.push(librarian.listDocuments({ industry, tag: "case-proof", verbose: true, limit: 12 }));
      listCalls.push(librarian.listDocuments({ industry, type: "deck", verbose: true, limit: 8 }));
    }
    listCalls.push(librarian.listDocuments({ industry, type: "case-study", verbose: true, limit: 8 }));
    listCalls.push(librarian.listDocuments({ industry, type: "one-pager", verbose: true, limit: 6 }));
  }

  const [answer, ...listings] = await Promise.all([
    librarian.ask(question).catch((err) => `(Librarian ask failed: ${err instanceof Error ? err.message : err})`),
    ...listCalls.map((p) => p.catch(() => "")),
  ]);
  return { answer, listings: mergeListings(listings, MAX_RETRIEVAL_CHARS - answer.length) };
}

const SYSTEM = `${FACLON_CONTEXT}

You are a senior account executive at Faclon preparing an industry brief that SDRs will use for cold outreach.
Base every claim strictly on the collateral provided. Never invent clients, numbers or documents.
Rules:
- typicalResults: copy numbers exactly as stated; mark evidence as delivered, poc or proposal_estimate.
- relevantClients: only companies named in the collateral; mark proposal-only accounts as "proposal".
- collateral: pick the 5-10 most useful documents, using their exact ids from the [brackets].
- emailSafe.proofPoints: never include prices, rates, discounts or commercial terms. Name a client only when the work was delivered; otherwise anonymise (e.g. "a leading cement producer").`;

async function generateBrief(ctx: Omit<CallCtx, "stage">, def: IndustryDef): Promise<IndustryBrief> {
  const { answer, listings } = await retrieveCollateral(def);
  const { data } = await runJson(
    { ...ctx, stage: "industry", industryKey: def.key },
    {
      model: env().MODEL_RESEARCH,
      max_tokens: 8000,
      output_config: { effort: "medium" },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content:
            `Industry: ${def.label} (${def.key}). Typical companies: ${def.examples}.\n\n` +
            `## Librarian answer (grounded in Faclon collateral)\n${answer}\n\n` +
            `## Relevant collateral (id | title | type | industry | client | year, with metrics and summary)\n${listings}\n\n` +
            `Write the industry brief.`,
        },
      ],
    },
    IndustryBriefSchema,
  );
  return data;
}

/** Returns the cached brief for an industry, generating it once (shared by all SDRs) when missing or stale. */
export async function ensureIndustryBrief(ctx: Omit<CallCtx, "stage">, industryKey: string): Promise<IndustryBrief> {
  const def = industryDef(industryKey);
  return singleFlight(`industry:${def.key}`, async () => {
    const [row] = await db.select().from(schema.industries).where(eq(schema.industries.key, def.key));
    if (row?.status === "ready" && row.brief && isFresh(row.researchedAt, TTL_DAYS.industry)) {
      await recordCacheHit({ ...ctx, stage: "industry" }, def.key);
      return row.brief as IndustryBrief;
    }
    const base = { key: def.key, librarianIndustry: def.librarianIndustries[0], label: def.label };
    try {
      const brief = await generateBrief(ctx, def);
      const values = { ...base, brief, status: "ready", error: null, researchedAt: new Date() };
      await db.insert(schema.industries).values(values).onConflictDoUpdate({ target: schema.industries.key, set: values });
      return brief;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .insert(schema.industries)
        .values({ ...base, status: "failed", error: message })
        .onConflictDoUpdate({ target: schema.industries.key, set: { status: "failed", error: message } });
      throw err;
    }
  });
}

/** Compact projection used inside company research and drafting prompts. */
export function briefForPrompt(brief: IndustryBrief): string {
  return [
    `Summary: ${brief.summary}`,
    `Use cases: ${brief.useCases.map((u) => `${u.title} [${u.offerings.join(", ")}]`).join("; ")}`,
    `Proof points (email-safe): ${brief.emailSafe.proofPoints.join(" | ")}`,
    `Pain points: ${brief.emailSafe.painPoints.join(" | ")}`,
    `Hooks: ${brief.emailSafe.hooks.join(" | ")}`,
    `Referenceable clients: ${brief.relevantClients.filter((c) => c.status !== "proposal").map((c) => c.name).join(", ") || "none"}`,
  ].join("\n");
}
