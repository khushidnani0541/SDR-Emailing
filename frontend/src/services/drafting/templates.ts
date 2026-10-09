import { and, desc, eq } from "drizzle-orm";
import { google } from "googleapis";
import { db, schema } from "@/db";
import { clientForUser } from "@/auth/google";
import { EMAIL_DAYS, type EmailDay } from "@/services/cadence/calendar";

// PLACEHOLDER guidelines used until the SDR cadence doc is imported (Settings -> Templates).
export const DEFAULT_TEMPLATES: Record<EmailDay, string> = {
  1: `PLACEHOLDER - replace by importing the SDR cadence doc.
Goal: follow up the first call and earn a 15-minute conversation.
- Subject: short (2-5 words), specific to their plant/role, no clickbait.
- Open with the call: if call notes say we spoke, reference what they said; otherwise "tried you earlier today".
- One sentence on why we reached out to THEM: a company signal or their role's likely priority.
- One relevant proof point from the same industry.
- Soft CTA: 15 minutes this week or next.
- 90-130 words.`,
  4: `PLACEHOLDER - replace by importing the SDR cadence doc.
Goal: add new value as a reply in the same thread.
- Don't repeat Day 1. Lead with a different use case relevant to their equipment/processes.
- Include one quantified result (anonymised if not a referenceable client).
- CTA: a yes/no question about whether this problem is on their radar.
- 60-100 words.`,
  7: `PLACEHOLDER - replace by importing the SDR cadence doc.
Goal: share a useful resource.
- Offer one specific case study / deck from the industry brief collateral (by title) that matches their likely priority.
- One line on what they'd learn from it.
- CTA: "Want me to send it over?" or offer a short walkthrough.
- 50-90 words.`,
  12: `PLACEHOLDER - replace by importing the SDR cadence doc.
Goal: polite close-the-loop (break-up) email.
- Acknowledge they're busy; no guilt-tripping.
- One-line recap of the value angle.
- Ask if someone else owns this (e.g. plant head, energy manager, digital lead), or if timing is better next quarter.
- 40-70 words.`,
};

export type ActiveTemplates = { version: number; byDay: Record<EmailDay, string> };

export async function getActiveTemplates(): Promise<ActiveTemplates> {
  const rows = await db.select().from(schema.templates).where(eq(schema.templates.active, true)).orderBy(desc(schema.templates.version));
  const byDay = { ...DEFAULT_TEMPLATES };
  let version = 0;
  for (const day of EMAIL_DAYS) {
    const row = rows.find((r) => r.day === day);
    if (row) {
      byDay[day] = row.guidelines;
      version = Math.max(version, row.version);
    }
  }
  return { version, byDay };
}

/** Splits cadence-doc text into Day 1/4/7/12 sections by their headings. */
export function splitCadenceDoc(text: string): Partial<Record<EmailDay, string>> {
  const out: Partial<Record<EmailDay, string>> = {};
  const re = /^[ \t#*]*(?:day|d)[ \t-]*(\d{1,2})\b[^\n]*$/gim;
  const marks = [...text.matchAll(re)].map((m) => ({ day: Number(m[1]), start: m.index!, bodyStart: m.index! + m[0].length }));
  marks.forEach((m, i) => {
    if (!(EMAIL_DAYS as readonly number[]).includes(m.day)) return;
    const end = i + 1 < marks.length ? marks[i + 1].start : text.length;
    const body = text.slice(m.bodyStart, end).trim();
    // Keep the first email section per day (a doc may also list call scripts for the same day later).
    if (body && !out[m.day as EmailDay]) out[m.day as EmailDay] = body;
  });
  return out;
}

export function parseDocId(url: string): string | null {
  return url.match(/\/document\/d\/([a-zA-Z0-9-_]+)/)?.[1] ?? null;
}

/** Imports the SDR cadence doc (Google Doc) as a new active template version. */
export async function importCadenceDoc(userId: string, docUrl: string): Promise<{ version: number; days: number[] }> {
  const docId = parseDocId(docUrl);
  if (!docId) throw new Error("That doesn't look like a Google Docs link");
  const docs = google.docs({ version: "v1", auth: await clientForUser(userId) });
  const { data } = await docs.documents.get({ documentId: docId });
  const text = (data.body?.content ?? [])
    .map((el) => (el.paragraph?.elements ?? []).map((e) => e.textRun?.content ?? "").join(""))
    .join("");
  const sections = splitCadenceDoc(text);
  const days = Object.keys(sections).map(Number);
  if (!days.length) throw new Error("Couldn't find 'Day 1 / Day 4 / Day 7 / Day 12' sections in the doc");

  const current = await getActiveTemplates();
  const version = current.version + 1;
  await db.transaction(async (tx) => {
    for (const day of days) {
      await tx
        .update(schema.templates)
        .set({ active: false })
        .where(and(eq(schema.templates.day, day), eq(schema.templates.active, true)));
      await tx.insert(schema.templates).values({ day, version, guidelines: sections[day as EmailDay]!, sourceDocId: docId });
    }
  });
  return { version, days };
}
