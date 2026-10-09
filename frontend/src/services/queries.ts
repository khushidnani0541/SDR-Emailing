import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { effectiveSettings } from "@/services/cadence/actions";
import { localDate } from "@/services/cadence/calendar";
import type { CompanyResearch, IndustryBrief, PersonResearch } from "@/services/research/types";

// Read models for pages. Every function takes the signed-in SDR's id from the data access layer.

export type ReviewEmail = {
  id: string;
  day: number;
  status: string;
  subject: string | null;
  body: string | null;
  rationale: string | null;
  proofPoints: string[];
  warnings: string[];
  error: string | null;
  scheduledFor: string | null;
  dueDate: string;
  updatedAt: string; // remounts the editor when the server copy changes
  plannedSendAt: string | null; // Day 1: time set at upload, only while it is still ahead
  prospect: { id: string; name: string; title: string | null; company: string; email: string; lastSubject: string | null };
};

export async function getTodayData(userId: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  const settings = effectiveSettings(user);
  const today = localDate(new Date(), settings.timezone);

  const emailRows = await db
    .select({ email: schema.emails, prospect: schema.prospects, day1SendAt: schema.uploads.day1SendAt })
    .from(schema.emails)
    .innerJoin(schema.prospects, eq(schema.prospects.id, schema.emails.prospectId))
    .innerJoin(schema.uploads, eq(schema.uploads.id, schema.prospects.uploadId))
    .where(
      and(
        eq(schema.emails.userId, userId),
        sql`(${schema.emails.dueDate} = ${today} or ${schema.emails.status} in ('pending_review','generating','failed'))`,
      ),
    )
    .orderBy(asc(schema.emails.day), asc(schema.prospects.companyName), asc(schema.prospects.name));

  const expired = await db
    .select({ id: schema.emails.id })
    .from(schema.emails)
    .where(and(eq(schema.emails.userId, userId), eq(schema.emails.status, "expired"), gte(schema.emails.dueDate, sql`(${today}::date - 3)`)));

  const calls = await db
    .select({ task: schema.callTasks, prospect: schema.prospects, person: schema.personResearch })
    .from(schema.callTasks)
    .innerJoin(schema.prospects, eq(schema.prospects.id, schema.callTasks.prospectId))
    .leftJoin(schema.personResearch, eq(schema.personResearch.key, schema.prospects.personKey))
    .where(and(eq(schema.callTasks.userId, userId), lte(schema.callTasks.dueDate, today), eq(schema.callTasks.status, "pending")))
    .orderBy(asc(schema.callTasks.dueDate), asc(schema.callTasks.day));

  const emails: ReviewEmail[] = emailRows.map(({ email, prospect, day1SendAt }) => ({
    id: email.id,
    day: email.day,
    status: email.status,
    subject: email.subject,
    body: email.body,
    rationale: email.rationale,
    proofPoints: email.proofPoints ?? [],
    warnings: email.guardrailWarnings,
    error: email.error,
    scheduledFor: email.scheduledFor?.toISOString() ?? null,
    dueDate: email.dueDate,
    updatedAt: email.updatedAt.toISOString(),
    plannedSendAt: email.day === 1 && day1SendAt && day1SendAt.getTime() > Date.now() ? day1SendAt.toISOString() : null,
    prospect: {
      id: prospect.id,
      name: prospect.name,
      title: prospect.title,
      company: prospect.companyName,
      email: prospect.email,
      lastSubject: prospect.lastSubject,
    },
  }));

  const latestRun = await db
    .select()
    .from(schema.dailyRuns)
    .where(eq(schema.dailyRuns.userId, userId))
    .orderBy(desc(schema.dailyRuns.startedAt))
    .limit(1);

  return {
    today,
    settings,
    gmailConnected: user.gmailConnected,
    emails,
    expiredIds: expired.map((e) => e.id),
    latestRun: latestRun[0] ?? null,
    calls: calls.map(({ task, prospect, person }) => ({
      id: task.id,
      day: task.day,
      dueDate: task.dueDate,
      overdue: task.dueDate < today,
      prospect: { id: prospect.id, name: prospect.name, title: prospect.title, company: prospect.companyName, email: prospect.email },
      opener: (person?.research as PersonResearch | null)?.callOpener ?? null,
      priorities: ((person?.research as PersonResearch | null)?.priorities ?? []).slice(0, 3).map((p) => p.point),
    })),
  };
}

export async function getProspectResearch(userId: string, prospectId: string) {
  const [prospect] = await db
    .select()
    .from(schema.prospects)
    .where(and(eq(schema.prospects.id, prospectId), eq(schema.prospects.userId, userId)));
  if (!prospect) return null;
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.key, prospect.companyKey));
  const [person] = await db.select().from(schema.personResearch).where(eq(schema.personResearch.key, prospect.personKey));
  const [industry] = company?.industryKey
    ? await db.select().from(schema.industries).where(eq(schema.industries.key, company.industryKey))
    : [];
  const emails = await db.select().from(schema.emails).where(eq(schema.emails.prospectId, prospectId)).orderBy(asc(schema.emails.day));
  const calls = await db.select().from(schema.callTasks).where(eq(schema.callTasks.prospectId, prospectId)).orderBy(asc(schema.callTasks.day));
  return {
    prospect,
    company: company ? { ...company, research: company.research as CompanyResearch | null } : null,
    person: person ? { ...person, research: person.research as PersonResearch | null } : null,
    industry: industry ? { ...industry, brief: industry.brief as IndustryBrief | null } : null,
    emails,
    calls,
  };
}

export async function getProspects(userId: string, status?: string) {
  const where = status
    ? and(eq(schema.prospects.userId, userId), eq(schema.prospects.status, status as "active"))
    : eq(schema.prospects.userId, userId);
  const rows = await db
    .select({
      prospect: schema.prospects,
      industryKey: schema.companies.industryKey,
      sent: sql<number>`(select count(*)::int from ${schema.emails} e where e.prospect_id = ${schema.prospects.id} and e.status = 'sent')`,
    })
    .from(schema.prospects)
    .leftJoin(schema.companies, eq(schema.companies.key, schema.prospects.companyKey))
    .where(where)
    .orderBy(desc(schema.prospects.createdAt))
    .limit(500);
  return rows;
}

export async function getUploads(userId: string) {
  return db.select().from(schema.uploads).where(eq(schema.uploads.userId, userId)).orderBy(desc(schema.uploads.createdAt)).limit(10);
}

export async function getUploadProgress(userId: string, uploadId: string) {
  const [upload] = await db.select().from(schema.uploads).where(and(eq(schema.uploads.id, uploadId), eq(schema.uploads.userId, userId)));
  if (!upload) return null;
  const prospects = await db.select().from(schema.prospects).where(eq(schema.prospects.uploadId, uploadId));
  const keys = prospects.map((p) => p.companyKey);
  const people = prospects.map((p) => p.personKey);
  const companies = keys.length ? await db.select({ key: schema.companies.key, status: schema.companies.status }).from(schema.companies).where(inArray(schema.companies.key, keys)) : [];
  const persons = people.length ? await db.select({ key: schema.personResearch.key, status: schema.personResearch.status }).from(schema.personResearch).where(inArray(schema.personResearch.key, people)) : [];
  const emails = prospects.length
    ? await db.select({ status: schema.emails.status }).from(schema.emails).where(and(inArray(schema.emails.prospectId, prospects.map((p) => p.id)), eq(schema.emails.day, 1)))
    : [];
  const count = <T extends { status: string }>(rows: T[], s: string) => rows.filter((r) => r.status === s).length;
  return {
    upload,
    total: prospects.length,
    companies: { total: new Set(keys).size, ready: count(companies, "ready"), failed: count(companies, "failed") },
    people: { total: new Set(people).size, ready: count(persons, "ready"), failed: count(persons, "failed") },
    drafts: { ready: emails.filter((e) => e.status !== "generating" && e.status !== "failed").length, failed: count(emails, "failed") },
  };
}

export async function getIndustries() {
  return db.select().from(schema.industries).orderBy(asc(schema.industries.label));
}

// ---------- Costs ----------

export async function getCosts(range: { from: Date; to: Date; timeZone: string }, userId?: string) {
  const where = and(
    gte(schema.usageLogs.createdAt, range.from),
    lte(schema.usageLogs.createdAt, range.to),
    userId ? eq(schema.usageLogs.userId, userId) : undefined,
  );
  const totals = sql`
    coalesce(sum(${schema.usageLogs.inputTokens}),0)::int as "input",
    coalesce(sum(${schema.usageLogs.outputTokens}),0)::int as "output",
    coalesce(sum(${schema.usageLogs.cacheReadTokens}),0)::int as "cacheRead",
    coalesce(sum(${schema.usageLogs.cacheWriteTokens}),0)::int as "cacheWrite",
    coalesce(sum(${schema.usageLogs.webSearches}),0)::int as "webSearches",
    coalesce(sum(${schema.usageLogs.webFetches}),0)::int as "webFetches",
    coalesce(sum(${schema.usageLogs.costUsd}),0)::float as "cost",
    count(*)::int as "calls"`;

  type Totals = { input: number; output: number; cacheRead: number; cacheWrite: number; webSearches: number; webFetches: number; cost: number; calls: number };
  const [overall] = (await db.execute(sql`select ${totals} from ${schema.usageLogs} where ${where}`)).rows as Totals[];
  const byStage = (await db.execute(sql`select ${schema.usageLogs.stage} as "stage", ${totals} from ${schema.usageLogs} where ${where} group by 1 order by "cost" desc`)).rows as (Totals & { stage: string })[];
  const byDay = (await db.execute(sql`select to_char(${schema.usageLogs.createdAt} at time zone ${range.timeZone}, 'YYYY-MM-DD') as "day", ${totals} from ${schema.usageLogs} where ${where} group by 1 order by 1`)).rows as (Totals & { day: string })[];
  const byUser = (await db.execute(
    sql`select coalesce(u.email, 'system') as "sdr", ${totals} from ${schema.usageLogs} left join ${schema.users} u on u.id = ${schema.usageLogs.userId} where ${where} group by 1 order by "cost" desc`,
  )).rows as (Totals & { sdr: string })[];
  const byModel = (await db.execute(sql`select ${schema.usageLogs.model} as "model", ${schema.usageLogs.batch} as "batch", ${totals} from ${schema.usageLogs} where ${where} group by 1, 2 order by "cost" desc`)).rows as (Totals & { model: string; batch: boolean })[];

  const hitWhere = and(gte(schema.cacheHits.createdAt, range.from), lte(schema.cacheHits.createdAt, range.to), userId ? eq(schema.cacheHits.userId, userId) : undefined);
  const hits = (await db.execute(sql`select ${schema.cacheHits.stage} as "stage", count(*)::int as "hits" from ${schema.cacheHits} where ${hitWhere} group by 1`)).rows as { stage: string; hits: number }[];

  const emailWhere = and(gte(schema.emails.sentAt, range.from), lte(schema.emails.sentAt, range.to), userId ? eq(schema.emails.userId, userId) : undefined);
  const [{ sent }] = (await db.execute(sql`select count(*)::int as "sent" from ${schema.emails} where ${emailWhere}`)).rows as { sent: number }[];
  const draftedWhere = and(gte(schema.emails.createdAt, range.from), lte(schema.emails.createdAt, range.to), userId ? eq(schema.emails.userId, userId) : undefined);
  const [{ drafted }] = (await db.execute(sql`select count(*)::int as "drafted" from ${schema.emails} where ${draftedWhere} and ${schema.emails.body} is not null`)).rows as { drafted: number }[];
  const prospectWhere = and(gte(schema.usageLogs.createdAt, range.from), lte(schema.usageLogs.createdAt, range.to), userId ? eq(schema.usageLogs.userId, userId) : undefined);
  const [{ prospects }] = (await db.execute(sql`select count(distinct ${schema.usageLogs.prospectId})::int as "prospects" from ${schema.usageLogs} where ${prospectWhere}`)).rows as { prospects: number }[];

  return { overall, byStage, byDay, byUser, byModel, hits, sent, drafted, prospects };
}
