import { and, desc, eq } from "drizzle-orm";
import { google } from "googleapis";
import mammoth from "mammoth";
import { db, schema } from "@/db";
import { clientForUser } from "@/auth/google";
import { EMAIL_DAYS, LINKEDIN_DAY } from "@/services/cadence/calendar";

/** Days the cadence doc has written templates for: the four emails plus the Day 6 LinkedIn note. */
export const TEMPLATE_DAYS = [...EMAIL_DAYS, LINKEDIN_DAY] as const;
export type TemplateDay = (typeof TEMPLATE_DAYS)[number];

// Built-in copy of the "SDR Cadence" doc (imported 2026-10-09). Settings -> Templates replaces it
// with a newer version whenever the doc changes.
export const DEFAULT_TEMPLATES: Record<TemplateDay, string> = {
  1: `Hi {{First Name}},

Tried reaching you earlier but couldn’t catch you.

Across manufacturing, the conversation is moving beyond simply collecting plant data. Companies like {{Relevant Companies}} are using it to improve production, reduce downtime, catch quality issues earlier and make maintenance more proactive.

The interesting part is that many are doing this without replacing their existing plant systems.

The gap is starting to show between plants that have the data and plants that are actually using it to improve performance.

Curious if this is something {{Company}} is already working on?

Would love to have a conversation around it.

Best,
{{SDR Name}}`,
  4: `Hi {{First Name}},

Following up on my note below with a relevant example.

A manufacturer in the {{industry}} space was able to use manufacturing intelligence to improve {{production / quality / maintenance}}, delivering {{X% improvement / X% reduction}}.

What stood out was how they were able to turn data from their existing operations into actionable insights, rather than just another layer of reporting.

The case study is attached. I thought it would be useful given the kind of operations {{Company}} runs.

Curious to hear if you’re seeing similar opportunities on your side.

Best,
{{SDR Name}}`,
  6: `Hi {{First Name}}, we help manufacturing companies improve production, reduce downtime, strengthen quality and improve maintenance performance using their existing plant data. Thought it would be good to connect.

OR

Hi {{First Name}}, reaching out because we work with manufacturing companies on production, quality, safety, maintenance and energy performance. Thought it would be good to connect.`,
  7: `Hi {{First Name}},

One more thought based on {{Company}}’s manufacturing setup.

I noticed you have {{specific plant / process / equipment / manufacturing footprint}}. Given that setup, {{specific operational challenge or opportunity}} caught my attention.

For example, {{specific observation: multiple lines / high-speed packaging / energy-intensive process / critical rotating equipment / multiple plants}} can create interesting opportunities around {{specific use case}}.

We’ve been looking at similar manufacturing environments and thought this could be relevant for {{Company}} as well.

Curious if this is something your team is already looking at?

Would love to have a conversation around it.

Best,
{{SDR Name}}`,
  12: `Hi {{First Name}},

I’ve tried calling.
I’ve sent a few emails.
I even made my way over to LinkedIn.

At this point, I’m starting to think your inbox has a better screening process than I do. 😄

So I’ll take the hint and make this my last follow-up. No more emails, no more calls, no more “just checking in” from me.

If improving the economics of the operation ever becomes a priority, whether that means growing production, improving margins, or getting more out of the assets you already have, I’d be glad to reconnect.

Wishing you fewer breakdowns and better production numbers. 😉

Best,
{{SDR Name}}`,
};

export type ActiveTemplates = { version: number; byDay: Record<TemplateDay, string> };

export async function getActiveTemplates(): Promise<ActiveTemplates> {
  const rows = await db.select().from(schema.templates).where(eq(schema.templates.active, true)).orderBy(desc(schema.templates.version));
  const byDay = { ...DEFAULT_TEMPLATES };
  let version = 0;
  for (const day of TEMPLATE_DAYS) {
    const row = rows.find((r) => r.day === day);
    if (row) {
      byDay[day] = row.guidelines;
      version = Math.max(version, row.version);
    }
  }
  return { version, byDay };
}

/** Tidies text exported from Docs/Word: restores line breaks that exports often drop. */
export function normalizeTemplateText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/([.!?])(?=[A-Z][a-z’' ])/g, "$1\n") // "calling.I’ve" / "emails.I even" -> separate lines
    .replace(/(Best|Thanks|Regards|Cheers),[ \t]*(?=\{\{)/g, "$1,\n") // "Best,{{SDR Name}}"
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Splits cadence-doc text into per-day sections (Day 1/4/6/7/12) by their headings. */
export function splitCadenceDoc(text: string): Partial<Record<TemplateDay, string>> {
  const out: Partial<Record<TemplateDay, string>> = {};
  const re = /^[ \t#*]*(?:day|d)[ \t-]*(\d{1,2})\b[^\n]*$/gim;
  const marks = [...text.matchAll(re)].map((m) => ({ day: Number(m[1]), start: m.index!, bodyStart: m.index! + m[0].length }));
  marks.forEach((m, i) => {
    if (!(TEMPLATE_DAYS as readonly number[]).includes(m.day)) return;
    const end = i + 1 < marks.length ? marks[i + 1].start : text.length;
    const body = normalizeTemplateText(text.slice(m.bodyStart, end));
    // Keep the first section per day (a doc may also list call scripts for the same day later).
    if (body && !out[m.day as TemplateDay]) out[m.day as TemplateDay] = body;
  });
  return out;
}

/**
 * Fills a template that only needs the prospect's name/company. Returns null when research-based
 * placeholders remain, i.e. the model is needed. Saves a model call for fixed-copy days like Day 12.
 */
export function fillStatic(template: string, vars: { firstName: string; company: string }): string | null {
  const filled = template
    .replace(/\{\{\s*first\s*name\s*\}\}/gi, vars.firstName)
    .replace(/\{\{\s*company(\s*name)?\s*\}\}/gi, vars.company)
    .replace(/\n?\{\{\s*sdr\s*name\s*\}\}\s*$/i, "") // signature is appended at send time
    .trim();
  return filled.includes("{{") ? null : filled;
}

export function parseDocId(url: string): string | null {
  return url.match(/\/document\/d\/([a-zA-Z0-9-_]+)/)?.[1] ?? null;
}

async function saveTemplateVersion(sections: Partial<Record<TemplateDay, string>>, sourceDocId: string | null) {
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
      await tx.insert(schema.templates).values({ day, version, guidelines: sections[day as TemplateDay]!, sourceDocId });
    }
  });
  return { version, days };
}

/** Imports the cadence doc from a native Google Doc. */
export async function importCadenceDoc(userId: string, docUrl: string): Promise<{ version: number; days: number[] }> {
  const docId = parseDocId(docUrl);
  if (!docId) throw new Error("That doesn't look like a Google Docs link");
  const docs = google.docs({ version: "v1", auth: await clientForUser(userId) });
  try {
    const { data } = await docs.documents.get({ documentId: docId });
    const text = (data.body?.content ?? [])
      .map((el) => (el.paragraph?.elements ?? []).map((e) => e.textRun?.content ?? "").join(""))
      .join("");
    return saveTemplateVersion(splitCadenceDoc(text), docId);
  } catch (err) {
    if ((err as { code?: number }).code === 400) {
      throw new Error("That file is a Word document stored in Drive, not a Google Doc. Download it and upload the .docx instead.");
    }
    throw err;
  }
}

/** Imports the cadence doc from an uploaded .docx or .txt file. */
export async function importCadenceFile(fileName: string, data: ArrayBuffer): Promise<{ version: number; days: number[] }> {
  const text = fileName.toLowerCase().endsWith(".docx")
    ? (await mammoth.extractRawText({ buffer: Buffer.from(data) })).value
    : new TextDecoder().decode(data);
  return saveTemplateVersion(splitCadenceDoc(text), null);
}
