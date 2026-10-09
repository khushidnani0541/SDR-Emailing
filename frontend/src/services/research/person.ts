import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { runJson, type CallCtx } from "@/services/llm/tracked";
import { FACLON_CONTEXT } from "./faclon-context";
import { PersonResearchSchema, type PersonResearch } from "./types";
import { companyForPrompt, WEB_LIMITS, type CompanyRecord } from "./company";
import { isFresh, recordCacheHit, singleFlight, TTL_DAYS } from "./cache";

const SYSTEM = `${FACLON_CONTEXT}

You are a senior account executive researching one individual before outreach. The company has already been researched (provided below) - do not research the company again.
Use at most ${WEB_LIMITS.personSearches} web searches:
1. If no LinkedIn URL is given, search "<name> <company> linkedin" to find it. LinkedIn pages usually cannot be fetched; rely on the search snippet for headline, tenure and location.
2. Search "<name>" "<company>" for interviews, conference talks, press quotes, awards, articles or posts.
3. Optionally search their role topic (e.g. "<name> energy efficiency" or "<name> digital transformation").
Fetch at most ${WEB_LIMITS.personFetches} non-LinkedIn page, only if it is clearly about this person.
Rules:
- Be careful about identity: common names produce false matches. Only use a source if company or role matches. Set identityConfidence accordingly.
- priorities: what this person most likely worries about day to day in this role at this company. Mark each as "sourced" (they said or did something public) or "inferred" (from role + company context).
- personalizationHooks: specific, non-creepy angles for an email (a talk they gave, a plant they run, a project they announced). No personal-life details.
- callOpener: two natural sentences an SDR can say on a cold call.`;

async function research(
  ctx: Omit<CallCtx, "stage">,
  person: { name: string; title: string | null; linkedinUrl: string | null },
  company: CompanyRecord,
): Promise<PersonResearch> {
  const { data } = await runJson(
    { ...ctx, stage: "person", companyKey: company.key },
    {
      model: env().MODEL_RESEARCH,
      max_tokens: 8000,
      output_config: { effort: "medium" },
      system: SYSTEM,
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: WEB_LIMITS.personSearches },
        {
          type: "web_fetch_20260209",
          name: "web_fetch",
          max_uses: WEB_LIMITS.personFetches,
          max_content_tokens: 4000,
          blocked_domains: ["linkedin.com"],
        },
      ],
      messages: [
        {
          role: "user",
          content:
            `Person: ${person.name}\nTitle: ${person.title ?? "unknown"}\n` +
            `LinkedIn: ${person.linkedinUrl ?? "not provided - find it"}\n\n` +
            `Company research (already done):\n${companyForPrompt(company)}\n\nResearch this person.`,
        },
      ],
    },
    PersonResearchSchema,
  );
  return data;
}

/** Cached per person (LinkedIn URL, else email). */
export async function ensurePersonResearch(
  ctx: Omit<CallCtx, "stage">,
  person: { personKey: string; name: string; title: string | null; linkedinUrl: string | null },
  company: CompanyRecord,
): Promise<PersonResearch> {
  return singleFlight(`person:${person.personKey}`, async () => {
    const [row] = await db.select().from(schema.personResearch).where(eq(schema.personResearch.key, person.personKey));
    if (row?.status === "ready" && row.research && isFresh(row.researchedAt, TTL_DAYS.person)) {
      await recordCacheHit({ ...ctx, stage: "person" }, person.personKey);
      return row.research as PersonResearch;
    }
    try {
      const result = await research(ctx, person, company);
      const values = { key: person.personKey, research: result, status: "ready", error: null, researchedAt: new Date() };
      await db.insert(schema.personResearch).values(values).onConflictDoUpdate({ target: schema.personResearch.key, set: values });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .insert(schema.personResearch)
        .values({ key: person.personKey, status: "failed", error: message })
        .onConflictDoUpdate({ target: schema.personResearch.key, set: { status: "failed", error: message } });
      throw err;
    }
  });
}

export function personForPrompt(p: PersonResearch): string {
  return [
    `Role: ${p.currentRole}${p.tenure ? ` (${p.tenure})` : ""} - identity confidence ${p.identityConfidence}`,
    `Background: ${p.background}`,
    `Responsibilities: ${p.responsibilities.join("; ")}`,
    `Likely priorities: ${p.priorities.map((x) => `${x.point} (${x.basis})`).join("; ")}`,
    `Public mentions: ${p.publicMentions.map((m) => `${m.summary}${m.date ? ` (${m.date})` : ""}`).join(" | ") || "none"}`,
    `Personalization hooks: ${p.personalizationHooks.join(" | ") || "none"}`,
  ].join("\n");
}
