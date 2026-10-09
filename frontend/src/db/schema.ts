import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  numeric,
  uuid,
  date,
  uniqueIndex,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";

// ---------- Enums ----------

export const prospectStatus = pgEnum("prospect_status", [
  "researching",
  "active",
  "replied",
  "bounced",
  "meeting_booked",
  "not_interested",
  "completed",
  "stopped",
  "skipped",
]);

export const emailStatus = pgEnum("email_status", [
  "generating",
  "pending_review",
  "approved", // approved, Gmail draft created, waiting for send time
  "sent",
  "rejected",
  "expired",
  "cancelled", // stopped by reply/bounce/manual stop or draft deleted in Gmail
  "failed",
]);

export const callStatus = pgEnum("call_status", ["pending", "done"]);

export const llmStage = pgEnum("llm_stage", [
  "classify",
  "industry",
  "company",
  "person",
  "draft",
  "template",
]);

// ---------- SDRs ----------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  googleSub: text("google_sub").unique(),
  // AES-256-GCM encrypted refresh token (see src/auth/crypto.ts)
  refreshTokenEnc: text("refresh_token_enc"),
  grantedScopes: text("granted_scopes"),
  gmailConnected: boolean("gmail_connected").notNull().default(false),
  settings: jsonb("settings").$type<SdrSettings>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SdrSettings = {
  timezone?: string; // IANA, default America/New_York
  day1SendTime?: string; // "HH:mm" local, default Day 1 send time on the upload day
  defaultSendTime?: string; // "HH:mm" local, Day 4/7/12 send time
  spreadMinutes?: number; // spread sends over N minutes
  dailyCap?: number;
  signature?: string;
  morningRunTime?: string; // "HH:mm" local
  holidays?: string[]; // ISO dates
  draftOnly?: boolean; // safety: create Gmail drafts but never send
};

// ---------- Uploads & prospects ----------

export const uploads = pgTable("uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  source: text("source").notNull(), // sheet URL or file name
  day1SendAt: timestamp("day1_send_at", { withTimezone: true }),
  totalRows: integer("total_rows").notNull().default(0),
  readyRows: integer("ready_rows").notNull().default(0),
  skippedRows: jsonb("skipped_rows").$type<SkippedRow[]>().notNull().default([]),
  status: text("status").notNull().default("ingested"), // ingested | researching | drafted | failed
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SkippedRow = { row: number; name: string; company: string; reason: string };

export const prospects = pgTable(
  "prospects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    uploadId: uuid("upload_id").notNull().references(() => uploads.id),
    name: text("name").notNull(),
    title: text("title"),
    companyName: text("company_name").notNull(),
    companyKey: text("company_key").notNull(), // normalized, FK-ish to companies.key
    linkedinUrl: text("linkedin_url"),
    email: text("email").notNull(),
    personKey: text("person_key").notNull(), // FK-ish to person_research.key
    status: prospectStatus("status").notNull().default("researching"),
    stopReason: text("stop_reason"),
    day1Date: date("day1_date"), // local date Day 1 was sent
    threadId: text("thread_id"), // Gmail thread of Day 1
    rfcMessageId: text("rfc_message_id"), // Message-ID header of Day 1, for threading
    lastSubject: text("last_subject"),
    callNotes: text("call_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("prospects_user_status_idx").on(t.userId, t.status),
    index("prospects_email_idx").on(t.email),
  ],
);

// ---------- Research caches (shared across SDRs) ----------

export const industries = pgTable("industries", {
  key: text("key").primaryKey(), // e.g. manufacturing/cement
  librarianIndustry: text("librarian_industry").notNull(),
  label: text("label").notNull(),
  brief: jsonb("brief"), // IndustryBrief
  status: text("status").notNull().default("pending"), // pending | ready | failed
  error: text("error"),
  researchedAt: timestamp("researched_at", { withTimezone: true }),
});

export const companies = pgTable("companies", {
  key: text("key").primaryKey(), // normalized company name
  displayName: text("display_name").notNull(),
  industryKey: text("industry_key"),
  classifyConfidence: numeric("classify_confidence"),
  research: jsonb("research"), // CompanyResearch
  status: text("status").notNull().default("pending"),
  error: text("error"),
  researchedAt: timestamp("researched_at", { withTimezone: true }),
});

export const personResearch = pgTable("person_research", {
  key: text("key").primaryKey(), // linkedin url or email
  research: jsonb("research"), // PersonResearch
  status: text("status").notNull().default("pending"),
  error: text("error"),
  researchedAt: timestamp("researched_at", { withTimezone: true }),
});

// ---------- Templates ----------

export const templates = pgTable(
  "templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    day: integer("day").notNull(), // 1 | 4 | 7 | 12
    version: integer("version").notNull(),
    guidelines: text("guidelines").notNull(),
    sourceDocId: text("source_doc_id"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("templates_day_version_idx").on(t.day, t.version)],
);

// ---------- Emails ----------

export const emails = pgTable(
  "emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    prospectId: uuid("prospect_id").notNull().references(() => prospects.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    day: integer("day").notNull(),
    dueDate: date("due_date").notNull(), // local date this email belongs to
    subject: text("subject"),
    body: text("body"),
    rationale: text("rationale"),
    proofPoints: jsonb("proof_points").$type<string[]>(),
    guardrailWarnings: jsonb("guardrail_warnings").$type<string[]>().notNull().default([]),
    templateVersion: integer("template_version"),
    status: emailStatus("status").notNull().default("generating"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    gmailDraftId: text("gmail_draft_id"),
    gmailMessageId: text("gmail_message_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("emails_prospect_day_idx").on(t.prospectId, t.day),
    index("emails_user_due_idx").on(t.userId, t.dueDate),
  ],
);

// ---------- Calls ----------

export const callTasks = pgTable(
  "call_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    prospectId: uuid("prospect_id").notNull().references(() => prospects.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    day: integer("day").notNull(), // 1 | 3 | 9 | 12
    dueDate: date("due_date").notNull(),
    status: callStatus("status").notNull().default("pending"),
    outcome: text("outcome"), // no_answer | connected | meeting_booked | not_interested | wrong_person
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("call_tasks_prospect_day_idx").on(t.prospectId, t.day)],
);

// ---------- Daily runs ----------

export const dailyRuns = pgTable(
  "daily_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    runDate: date("run_date").notNull(),
    kind: text("kind").notNull(), // upload | morning
    uploadId: uuid("upload_id"),
    status: text("status").notNull().default("running"), // running | done | failed
    batchId: text("batch_id"), // Anthropic message batch id, when used
    stats: jsonb("stats").$type<Record<string, number>>().notNull().default({}),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("daily_runs_user_date_idx").on(t.userId, t.runDate)],
);

// ---------- Cost tracking ----------

export const usageLogs = pgTable(
  "usage_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id"),
    userId: uuid("user_id"),
    stage: llmStage("stage").notNull(),
    model: text("model").notNull(),
    batch: boolean("batch").notNull().default(false),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    webSearches: integer("web_searches").notNull().default(0),
    webFetches: integer("web_fetches").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull(),
    prospectId: uuid("prospect_id"),
    companyKey: text("company_key"),
    industryKey: text("industry_key"),
    emailId: uuid("email_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usage_logs_created_idx").on(t.createdAt), index("usage_logs_user_idx").on(t.userId)],
);

// Research work avoided because a cached result was reused (powers the "calls saved" metric).
export const cacheHits = pgTable("cache_hits", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id"),
  userId: uuid("user_id"),
  stage: llmStage("stage").notNull(),
  key: text("key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Org-wide settings (single row, id = "global") ----------

export type AppSettings = {
  referenceableClients?: string[]; // client names SDRs may name in emails
  cadenceDocUrl?: string;
};

export const appSettings = pgTable("app_settings", {
  id: text("id").primaryKey(),
  value: jsonb("value").$type<AppSettings>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
