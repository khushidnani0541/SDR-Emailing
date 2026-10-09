import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CallCtx } from "@/services/llm/tracked";
import { ensureIndustryBrief } from "@/services/research/industry";
import { ensureCompanyResearch, type CompanyRecord } from "@/services/research/company";
import { ensurePersonResearch } from "@/services/research/person";
import type { IndustryBrief, PersonResearch } from "@/services/research/types";
import type { DraftInput } from "@/services/drafting/draft";
import type { EmailDay } from "./calendar";

type Prospect = typeof schema.prospects.$inferSelect;

/**
 * Assembles everything the drafting tool needs for one prospect/day from the research caches.
 * Research only runs if a cache entry is missing or stale (normally it was done at upload).
 */
export async function loadDraftInput(
  ctx: Omit<CallCtx, "stage">,
  prospect: Prospect,
  day: EmailDay,
): Promise<DraftInput> {
  const [companyRow] = await db.select().from(schema.companies).where(eq(schema.companies.key, prospect.companyKey));
  const provisionalIndustry = companyRow?.industryKey ?? "manufacturing/general";

  let brief: IndustryBrief | null = null;
  try {
    brief = await ensureIndustryBrief(ctx, provisionalIndustry);
  } catch (err) {
    console.error(`[draft-context] industry brief unavailable for ${provisionalIndustry}`, err);
  }

  const company: CompanyRecord = await ensureCompanyResearch(
    { ...ctx, prospectId: prospect.id },
    { key: prospect.companyKey, displayName: companyRow?.displayName ?? prospect.companyName, industryKey: provisionalIndustry },
    brief,
    prospect.title ? [prospect.title] : [],
  );

  // Company research may have corrected the industry; use that brief (cached) if so.
  if (company.industryKey !== provisionalIndustry) {
    try {
      brief = await ensureIndustryBrief(ctx, company.industryKey);
    } catch (err) {
      console.error(`[draft-context] industry brief unavailable for ${company.industryKey}`, err);
    }
  }

  let person: PersonResearch | null = null;
  try {
    person = await ensurePersonResearch(
      { ...ctx, prospectId: prospect.id },
      { personKey: prospect.personKey, name: prospect.name, title: prospect.title, linkedinUrl: prospect.linkedinUrl },
      company,
    );
  } catch (err) {
    console.error(`[draft-context] person research unavailable for ${prospect.id}`, err);
  }

  const previous = await db
    .select({ day: schema.emails.day, subject: schema.emails.subject, body: schema.emails.body })
    .from(schema.emails)
    .where(and(eq(schema.emails.prospectId, prospect.id), inArray(schema.emails.status, ["approved", "sent"])))
    .orderBy(asc(schema.emails.day));

  return {
    day,
    prospect: { name: prospect.name, title: prospect.title, companyName: prospect.companyName, callNotes: prospect.callNotes },
    industryKey: company.industryKey,
    brief,
    company,
    person,
    previousEmails: previous.filter((e) => e.day < day && e.body).map((e) => ({ day: e.day, subject: e.subject, body: e.body! })),
  };
}

/** Org-wide settings (referenceable client allowlist etc.). */
export async function getAppSettings(): Promise<schema.AppSettings> {
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.id, "global"));
  return row?.value ?? {};
}

export async function saveAppSettings(value: schema.AppSettings): Promise<void> {
  await db
    .insert(schema.appSettings)
    .values({ id: "global", value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.appSettings.id, set: { value, updatedAt: new Date() } });
}
