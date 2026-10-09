import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { runJson, type CallCtx } from "@/services/llm/tracked";
import { FACLON_CONTEXT } from "./faclon-context";
import { INDUSTRIES } from "./taxonomy";
import { CompanyResearchSchema, type CompanyResearch, type IndustryBrief } from "./types";
import { briefForPrompt } from "./industry";
import { isFresh, recordCacheHit, singleFlight, TTL_DAYS } from "./cache";

export const WEB_LIMITS = { companySearches: 5, companyFetches: 2, personSearches: 4, personFetches: 1 } as const;

const SYSTEM = `${FACLON_CONTEXT}

You are a senior account executive researching a target account before outreach.
Use web search efficiently: at most ${WEB_LIMITS.companySearches} searches. Good searches combine the company name with: "plant" / "capacity"; "expansion OR investment OR funding"; "automation OR robotics OR machine vision OR digital"; "hiring" or "layoffs".
Fetch a page only when a search snippet is not enough.
Rules:
- Prefer the last 18 months for signals; include the date and source URL for every signal. Do not invent signals; return an empty list if none are found.
- likelyMachinesAndProcesses: infer from the industry and products (e.g. kilns, ball mills, compressors, injection moulding machines, CNCs, boilers, chillers).
- digitalMaturity: judge from public evidence (MES/SCADA/SAP mentions, Industry 4.0 programmes, digital job postings); say what the evidence is.
- firstValueWedge: the single Faclon offering most likely to land first at this company, why, and the likely buyer role.
- confirmedIndustryKey must be one of: ${INDUSTRIES.map((i) => i.key).join(", ")}.
- If you cannot identify the company with confidence, say so in description and keep other fields conservative.`;

async function research(
  ctx: Omit<CallCtx, "stage">,
  company: { key: string; displayName: string; industryKey: string },
  brief: IndustryBrief | null,
  contactTitles: string[],
): Promise<CompanyResearch> {
  const { data } = await runJson(
    { ...ctx, stage: "company", companyKey: company.key },
    {
      model: env().MODEL_RESEARCH,
      max_tokens: 12000,
      output_config: { effort: "medium" },
      system: SYSTEM,
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: WEB_LIMITS.companySearches },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: WEB_LIMITS.companyFetches, max_content_tokens: 6000 },
      ],
      messages: [
        {
          role: "user",
          content:
            `Company: ${company.displayName}\n` +
            `Provisional industry: ${company.industryKey}\n` +
            (contactTitles.length ? `People we are contacting there: ${contactTitles.join("; ")}\n` : "") +
            (brief ? `\nWhat Faclon offers this industry:\n${briefForPrompt(brief)}\n` : "") +
            `\nResearch this company and return the account research.`,
        },
      ],
    },
    CompanyResearchSchema,
  );
  return data;
}

export type CompanyRecord = { key: string; displayName: string; industryKey: string; research: CompanyResearch };

/** Cached per normalized company (shared across SDRs and uploads). */
export async function ensureCompanyResearch(
  ctx: Omit<CallCtx, "stage">,
  company: { key: string; displayName: string; industryKey: string },
  brief: IndustryBrief | null,
  contactTitles: string[] = [],
): Promise<CompanyRecord> {
  return singleFlight(`company:${company.key}`, async () => {
    const [row] = await db.select().from(schema.companies).where(eq(schema.companies.key, company.key));
    if (row?.status === "ready" && row.research && isFresh(row.researchedAt, TTL_DAYS.company)) {
      await recordCacheHit({ ...ctx, stage: "company" }, company.key);
      return {
        key: row.key,
        displayName: row.displayName,
        industryKey: row.industryKey ?? company.industryKey,
        research: row.research as CompanyResearch,
      };
    }
    try {
      const result = await research(ctx, company, brief, contactTitles);
      const values = {
        key: company.key,
        displayName: company.displayName,
        industryKey: result.confirmedIndustryKey,
        research: result,
        status: "ready",
        error: null,
        researchedAt: new Date(),
      };
      await db.insert(schema.companies).values(values).onConflictDoUpdate({ target: schema.companies.key, set: values });
      return { key: company.key, displayName: company.displayName, industryKey: result.confirmedIndustryKey, research: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .insert(schema.companies)
        .values({ key: company.key, displayName: company.displayName, industryKey: company.industryKey, status: "failed", error: message })
        .onConflictDoUpdate({ target: schema.companies.key, set: { status: "failed", error: message } });
      throw err;
    }
  });
}

/** Compact projection for person research and drafting prompts. */
export function companyForPrompt(c: CompanyRecord): string {
  const r = c.research;
  return [
    `${c.displayName} (${c.industryKey}) - ${r.description}`,
    `Size: ${r.size.employees ?? "?"} employees, revenue ${r.size.revenue ?? "?"} (${r.size.band})`,
    `HQ: ${r.locations.hq ?? "?"}; plants: ${r.locations.plants.join(", ") || "?"}`,
    `Likely equipment/processes: ${r.likelyMachinesAndProcesses.join(", ")}`,
    `Recent signals: ${r.signals.map((s) => `[${s.type}${s.date ? `, ${s.date}` : ""}] ${s.summary}`).join(" | ") || "none found"}`,
    `Digital maturity: ${r.digitalMaturity.level}/5 - ${r.digitalMaturity.evidence}`,
    `First value wedge: ${r.firstValueWedge.offering} - ${r.firstValueWedge.why} (buyer: ${r.firstValueWedge.likelyBuyer})`,
  ].join("\n");
}
