import { z } from "zod";
import { INDUSTRY_KEYS } from "./taxonomy";

// Schemas avoid min/max/format keywords and optional fields so they stay within what
// structured outputs accept; "unknown" is expressed with null.

export const ClassificationSchema = z.object({
  companies: z.array(
    z.object({
      key: z.string(),
      industryKey: z.enum(INDUSTRY_KEYS),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
});

export const IndustryBriefSchema = z.object({
  summary: z.string().describe("2-3 sentences: why this industry buys Faclon and what it worries about"),
  useCases: z.array(
    z.object({
      title: z.string(),
      problem: z.string(),
      faclonSolution: z.string(),
      offerings: z.array(z.string()).describe("Faclon products/modules involved, e.g. IO Sense, DeepSense, IO Vision"),
    }),
  ),
  typicalResults: z.array(
    z.object({
      result: z.string().describe("Quantified outcome, as stated in the source"),
      client: z.string().nullable(),
      evidence: z.enum(["delivered", "poc", "proposal_estimate"]),
      sourceDocId: z.string().nullable(),
    }),
  ),
  relevantClients: z.array(
    z.object({ name: z.string(), status: z.enum(["delivered", "poc", "proposal"]), note: z.string() }),
  ),
  collateral: z.array(
    z.object({
      docId: z.string(),
      title: z.string(),
      type: z.string(),
      useFor: z.string().describe("When an SDR/AE should share or use it"),
    }),
  ),
  emailSafe: z.object({
    proofPoints: z
      .array(z.string())
      .describe("Short, outcome-led proof points safe for cold email. No pricing. Anonymize the client unless it is a delivered reference."),
    painPoints: z.array(z.string()),
    hooks: z.array(z.string()).describe("Opening angles an SDR could use with this industry"),
  }),
});
export type IndustryBrief = z.infer<typeof IndustryBriefSchema>;

export const CompanyResearchSchema = z.object({
  confirmedIndustryKey: z.enum(INDUSTRY_KEYS),
  website: z.string().nullable(),
  description: z.string(),
  size: z.object({
    employees: z.string().nullable().describe("e.g. '~4,500' or '1,000-5,000'"),
    revenue: z.string().nullable(),
    band: z.enum(["small", "mid", "large", "enterprise", "unknown"]),
  }),
  locations: z.object({ hq: z.string().nullable(), plants: z.array(z.string()) }),
  likelyMachinesAndProcesses: z.array(z.string()),
  signals: z.array(
    z.object({
      type: z.enum([
        "expansion",
        "funding",
        "downsizing",
        "hiring",
        "automation_robotics_vision",
        "digital_initiative",
        "leadership_change",
        "sustainability",
        "other",
      ]),
      summary: z.string(),
      date: z.string().nullable(),
      sourceUrl: z.string().nullable(),
    }),
  ),
  digitalMaturity: z.object({
    level: z.number().int().describe("1 = paper/manual, 3 = some SCADA/MES islands, 5 = plant-wide IIoT + analytics"),
    evidence: z.string(),
  }),
  firstValueWedge: z.object({
    offering: z.string(),
    why: z.string(),
    likelyBuyer: z.string(),
  }),
  sources: z.array(z.string()),
});
export type CompanyResearch = z.infer<typeof CompanyResearchSchema>;

export const PersonResearchSchema = z.object({
  identityConfidence: z.enum(["high", "medium", "low"]).describe("How sure we are the sources are about this exact person"),
  linkedinUrl: z.string().nullable(),
  currentRole: z.string(),
  tenure: z.string().nullable(),
  background: z.string(),
  responsibilities: z.array(z.string()),
  priorities: z.array(
    z.object({
      point: z.string().describe("Something this person likely worries about day to day"),
      basis: z.enum(["sourced", "inferred"]),
      sourceUrl: z.string().nullable(),
    }),
  ),
  publicMentions: z.array(z.object({ summary: z.string(), url: z.string(), date: z.string().nullable() })),
  personalizationHooks: z.array(z.string()),
  callOpener: z.string().describe("A 2-sentence opener the SDR can use on the phone"),
  sources: z.array(z.string()),
});
export type PersonResearch = z.infer<typeof PersonResearchSchema>;
