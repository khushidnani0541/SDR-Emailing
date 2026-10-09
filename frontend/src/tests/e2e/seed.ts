// E2E FIXTURE DATA (clearly labelled). Used only by the Playwright suite against the
// throwaway `sdr_cadence_test` database. Live runs use real research from the pipeline.
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import type { CompanyResearch, IndustryBrief, PersonResearch } from "@/services/research/types";

export const TEST_USER_EMAIL = "sdr.fixture@example.com";

const brief: IndustryBrief = {
  summary: "Cement plants buy Faclon to cut specific power and heat consumption and stabilise kiln quality. [fixture]",
  useCases: [
    { title: "Kiln SHC optimiser", problem: "Specific heat consumption drifts with raw-mix variability", faclonSolution: "Process AI recommends kiln setpoints", offerings: ["IO Sense", "Process AI"] },
    { title: "Open-access power scheduling", problem: "Manual 15-min block booking causes over/under drawal", faclonSolution: "AI demand forecasting", offerings: ["Energy Management System"] },
  ],
  typicalResults: [{ result: "Forecast error cut from 16% to 8.4% MAPE", client: "JSW Cement", evidence: "poc", sourceDocId: "jsw-cements-dolvi-poc-results-summary" }],
  relevantClients: [
    { name: "JSW Cement", status: "delivered", note: "Dolvi energy forecasting" },
    { name: "UltraTech Cement", status: "proposal", note: "Co-sell scoping only" },
  ],
  collateral: [{ docId: "jsw-cements-dolvi-poc-results-summary", title: "JSW Cements Dolvi — Energy Forecasting POC Results", type: "case-study", useFor: "Energy/plant heads worried about power cost" }],
  emailSafe: {
    proofPoints: ["Halved power-forecast error for a leading cement producer"],
    painPoints: ["Power is the biggest controllable cost"],
    hooks: ["New kiln line commissioning"],
  },
};

const company: CompanyResearch = {
  confirmedIndustryKey: "manufacturing/cement",
  website: "https://example.com",
  description: "Fixture Cement Works is a fictional 4 MTPA cement producer used for UI tests.",
  size: { employees: "~2,000", revenue: "₹3,000 Cr", band: "large" },
  locations: { hq: "Mumbai", plants: ["Plant A", "Plant B"] },
  likelyMachinesAndProcesses: ["rotary kiln", "VRM", "ball mill", "ID fans"],
  signals: [{ type: "expansion", summary: "Announced a 2 MTPA brownfield line [fixture]", date: "2026-07", sourceUrl: "https://example.com/news" }],
  digitalMaturity: { level: 3, evidence: "SCADA in place, no plant-wide analytics [fixture]" },
  firstValueWedge: { offering: "Energy Management System", why: "Power cost is top of mind during expansion", likelyBuyer: "Plant Head" },
  sources: ["https://example.com/news"],
};

const person: PersonResearch = {
  identityConfidence: "high",
  linkedinUrl: null,
  currentRole: "Plant Head",
  tenure: "3 years",
  background: "Process engineer turned plant head [fixture]",
  responsibilities: ["Plant P&L", "Kiln uptime"],
  priorities: [{ point: "Keeping power cost per tonne down during the expansion", basis: "inferred", sourceUrl: null }],
  publicMentions: [],
  personalizationHooks: ["New line commissioning"],
  callOpener: "Saw you're adding a second line at Plant A — curious how you're planning to keep power per tonne flat while it ramps up.",
  sources: [],
};

export async function seed(databaseUrl: string): Promise<{ userId: string }> {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  try {
    const [user] = await db
      .insert(schema.users)
      .values({ email: TEST_USER_EMAIL, name: "Fixture SDR", gmailConnected: false, settings: { timezone: "Asia/Kolkata", defaultSendTime: "10:00" } })
      .returning();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

    await db.insert(schema.industries).values({ key: "manufacturing/cement", librarianIndustry: "manufacturing", label: "Cement", brief, status: "ready", researchedAt: new Date() });
    await db.insert(schema.companies).values({ key: "fixture-cement-works", displayName: "Fixture Cement Works", industryKey: "manufacturing/cement", research: company, status: "ready", researchedAt: new Date() });

    const [upload] = await db.insert(schema.uploads).values({ userId: user.id, source: "fixture.csv", totalRows: 3, readyRows: 3, status: "drafted" }).returning();
    const people = [
      { name: "Asha Rao", title: "Plant Head", email: "asha.rao@example.com" },
      { name: "Ravi Kumar", title: "Head of Energy", email: "ravi.kumar@example.com" },
      { name: "Meera Shah", title: "VP Operations", email: "meera.shah@example.com" },
    ];
    const prospects = await db
      .insert(schema.prospects)
      .values(
        people.map((p) => ({
          userId: user.id,
          uploadId: upload.id,
          name: p.name,
          title: p.title,
          companyName: "Fixture Cement Works",
          companyKey: "fixture-cement-works",
          email: p.email,
          personKey: `email:${p.email}`,
          status: "active" as const,
        })),
      )
      .returning();
    await db.insert(schema.personResearch).values(prospects.map((p) => ({ key: p.personKey, research: person, status: "ready", researchedAt: new Date() })));

    await db.insert(schema.emails).values([
      {
        prospectId: prospects[0].id,
        userId: user.id,
        day: 1,
        dueDate: today,
        subject: "Power per tonne at Plant A",
        body: "Hi Asha,\n\nTried you earlier today. With the new line coming up, power per tonne usually creeps up during ramp-up.\n\nWe halved power-forecast error for a leading cement producer. Worth 15 minutes next week?\n\nBest,",
        rationale: "Expansion signal + plant head's cost focus",
        proofPoints: ["Halved power-forecast error"],
        status: "pending_review" as const,
      },
      {
        prospectId: prospects[1].id,
        userId: user.id,
        day: 1,
        dueDate: today,
        subject: "Open-access scheduling",
        body: "Hi Ravi,\n\nWe helped UltraTech cut power costs. Our pricing starts low.\n\nBest,",
        rationale: "Energy head",
        proofPoints: [],
        guardrailWarnings: ["Mentions pricing/commercial terms - Faclon pricing must not appear in cold emails", "Names client(s) not on the referenceable list: UltraTech Cement"],
        status: "pending_review" as const,
      },
      {
        prospectId: prospects[2].id,
        userId: user.id,
        day: 1,
        dueDate: today,
        subject: "Kiln stability",
        body: "Hi Meera,\n\nQuick note on kiln stability during expansion.\n\nBest,",
        rationale: "Ops leader",
        proofPoints: [],
        status: "pending_review" as const,
      },
    ]);
    await db.update(schema.prospects).set({ phone: "+1 574-340-0023" }).where(eq(schema.prospects.id, prospects[2].id));
    await db.insert(schema.callTasks).values([
      { prospectId: prospects[2].id, userId: user.id, day: 3, kind: "call", dueDate: today, status: "pending" as const },
      { prospectId: prospects[0].id, userId: user.id, day: 6, kind: "linkedin", dueDate: today, status: "pending" as const },
    ]);

    await db.insert(schema.usageLogs).values([
      { userId: user.id, stage: "industry" as const, model: "claude-sonnet-5", inputTokens: 7000, outputTokens: 2000, costUsd: "0.034000", industryKey: "manufacturing/cement" },
      { userId: user.id, stage: "company" as const, model: "claude-sonnet-5", inputTokens: 25000, outputTokens: 1500, webSearches: 5, costUsd: "0.115000", companyKey: "fixture-cement-works" },
      { userId: user.id, stage: "draft" as const, model: "claude-sonnet-5", inputTokens: 900, outputTokens: 350, cacheReadTokens: 3000, costUsd: "0.005900", prospectId: prospects[0].id },
    ]);
    await db.insert(schema.cacheHits).values({ userId: user.id, stage: "company" as const, key: "fixture-cement-works" });
    return { userId: user.id };
  } finally {
    await pool.end();
  }
}
