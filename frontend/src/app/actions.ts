"use server";

import { refresh } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { getCurrentUser } from "@/auth/current-user";
import { db, schema } from "@/db";
import { errorMessage } from "@/lib/concurrency";
import { enqueue, QUEUES } from "@/worker/queue";
import { readCsv, readGoogleSheet, readXlsx } from "@/services/ingest/sources";
import { ingestUpload } from "@/services/cadence/upload";
import {
  approveEmails,
  effectiveSettings,
  CALL_OUTCOMES,
  editEmail,
  logCallOutcome,
  rejectEmail,
  reviveExpired,
  stopProspect,
  type ApproveResult,
  type CallOutcome,
} from "@/services/cadence/actions";
import { zonedTime } from "@/services/cadence/calendar";
import { importCadenceDoc } from "@/services/drafting/templates";
import { getAppSettings, saveAppSettings } from "@/services/cadence/context";

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// ---------- Upload ----------

export type UploadSummary = { uploadId: string; ready: number; skipped: schema.SkippedRow[] };

export async function uploadProspectsAction(_: unknown, form: FormData): Promise<ActionResult<UploadSummary>> {
  try {
    const user = await getCurrentUser();
    const sheetUrl = String(form.get("sheetUrl") ?? "").trim();
    const file = form.get("file");
    const day1Date = String(form.get("day1Date") ?? "");
    const day1Time = String(form.get("day1Time") ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day1Date) || !HHMM.test(day1Time)) return { ok: false, error: "Pick a Day 1 send date and time" };

    let rows: string[][];
    let source: string;
    if (sheetUrl) {
      if (!user.gmailConnected) return { ok: false, error: "Connect your Google account first (Settings)" };
      rows = await readGoogleSheet(user.id, sheetUrl);
      source = sheetUrl;
    } else if (file instanceof File && file.size > 0) {
      if (file.size > 5_000_000) return { ok: false, error: "File is larger than 5 MB" };
      const name = file.name.toLowerCase();
      if (name.endsWith(".csv")) rows = readCsv(await file.text());
      else if (name.endsWith(".xlsx")) rows = await readXlsx(await file.arrayBuffer());
      else return { ok: false, error: "Upload a .csv or .xlsx file, or paste a Google Sheet link" };
      source = file.name;
    } else {
      return { ok: false, error: "Paste a Google Sheet link or choose a file" };
    }
    if (rows.length < 2) return { ok: false, error: "The sheet has no prospect rows" };

    const tz = effectiveSettings({ settings: user.settings }).timezone;
    const day1SendAt = zonedTime(day1Date, day1Time, tz);
    const result = await ingestUpload(user.id, source, rows, day1SendAt);
    if (result.ready > 0) await enqueue(QUEUES.uploadPipeline, { uploadId: result.uploadId });
    refresh();
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ---------- Review queue ----------

export async function approveEmailsAction(emailIds: string[], sendTime: string, spreadMinutes: number): Promise<ActionResult<ApproveResult>> {
  try {
    const user = await getCurrentUser();
    if (!emailIds.length) return { ok: false, error: "Select at least one email" };
    if (!HHMM.test(sendTime)) return { ok: false, error: "Send time must be HH:MM" };
    const spread = Math.min(Math.max(Math.round(spreadMinutes), 0), 480);
    const result = await approveEmails(user.id, emailIds, sendTime, spread);
    refresh();
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function rejectEmailAction(emailId: string, mode: "skip" | "stop"): Promise<ActionResult> {
  try {
    const user = await getCurrentUser();
    await rejectEmail(user.id, emailId, mode === "stop" ? "stop" : "skip");
    refresh();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function editEmailAction(emailId: string, subject: string | null, body: string): Promise<ActionResult> {
  try {
    const user = await getCurrentUser();
    if (!body.trim()) return { ok: false, error: "Body can't be empty" };
    await editEmail(user.id, emailId, subject, body);
    refresh();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function regenerateEmailAction(emailId: string, instruction: string): Promise<ActionResult> {
  try {
    const user = await getCurrentUser();
    const [email] = await db
      .update(schema.emails)
      .set({ status: "generating", error: null, updatedAt: new Date() })
      .where(and(eq(schema.emails.id, emailId), eq(schema.emails.userId, user.id), inArray(schema.emails.status, ["pending_review", "failed", "expired"])))
      .returning({ id: schema.emails.id });
    if (!email) return { ok: false, error: "Only emails awaiting review can be regenerated" };
    await enqueue(QUEUES.regenerate, { emailId, instruction: instruction.trim().slice(0, 500) || null });
    refresh();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function reviveExpiredAction(emailIds: string[]): Promise<ActionResult<number>> {
  try {
    const user = await getCurrentUser();
    const n = await reviveExpired(user.id, emailIds);
    refresh();
    return { ok: true, data: n };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Manual trigger for today's morning run (normally the worker starts it at the SDR's morning time). */
export async function runMorningNowAction(): Promise<ActionResult<Record<string, number>>> {
  try {
    const user = await getCurrentUser();
    await enqueue(QUEUES.morningRun, { userId: user.id }, { singletonKey: `morning-manual:${user.id}:${new Date().toDateString()}` });
    return { ok: true, message: "Today's follow-ups are being prepared. This page will update when they're ready." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ---------- Calls & prospects ----------

export async function logCallAction(callTaskId: string, outcome: string, notes: string): Promise<ActionResult> {
  try {
    const user = await getCurrentUser();
    if (!(CALL_OUTCOMES as readonly string[]).includes(outcome)) return { ok: false, error: "Unknown call outcome" };
    await logCallOutcome(user.id, callTaskId, outcome as CallOutcome, notes.trim() || null);
    refresh();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function stopProspectAction(prospectId: string, reason: "meeting_booked" | "not_interested" | "stopped"): Promise<ActionResult> {
  try {
    const user = await getCurrentUser();
    const [p] = await db.select({ id: schema.prospects.id }).from(schema.prospects).where(and(eq(schema.prospects.id, prospectId), eq(schema.prospects.userId, user.id)));
    if (!p) return { ok: false, error: "Prospect not found" };
    await stopProspect(user.id, prospectId, reason, "Stopped by SDR");
    refresh();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ---------- Settings ----------

export async function saveSettingsAction(_: unknown, form: FormData): Promise<ActionResult> {
  try {
    const user = await getCurrentUser();
    const timezone = String(form.get("timezone") ?? "").trim();
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
    } catch {
      return { ok: false, error: `Unknown timezone "${timezone}"` };
    }
    const day1SendTime = String(form.get("day1SendTime"));
    const defaultSendTime = String(form.get("defaultSendTime"));
    const morningRunTime = String(form.get("morningRunTime"));
    if (![day1SendTime, defaultSendTime, morningRunTime].every((t) => HHMM.test(t))) return { ok: false, error: "Times must be HH:MM" };
    const holidays = String(form.get("holidays") ?? "")
      .split(/[\s,]+/)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    const settings: schema.SdrSettings = {
      timezone,
      day1SendTime,
      defaultSendTime,
      morningRunTime,
      spreadMinutes: Math.min(Math.max(Number(form.get("spreadMinutes")) || 0, 0), 480),
      dailyCap: Math.min(Math.max(Number(form.get("dailyCap")) || 150, 1), 500),
      signature: String(form.get("signature") ?? "").slice(0, 1000),
      holidays,
      draftOnly: form.get("draftOnly") === "on",
    };
    await db.update(schema.users).set({ settings, updatedAt: new Date() }).where(eq(schema.users.id, user.id));
    refresh();
    return { ok: true, message: "Settings saved" };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function saveOrgSettingsAction(_: unknown, form: FormData): Promise<ActionResult> {
  try {
    await getCurrentUser();
    const current = await getAppSettings();
    const referenceableClients = String(form.get("referenceableClients") ?? "")
      .split(/\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);
    await saveAppSettings({ ...current, referenceableClients });
    refresh();
    return { ok: true, message: "Saved" };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function importTemplatesAction(_: unknown, form: FormData): Promise<ActionResult> {
  try {
    const user = await getCurrentUser();
    const url = String(form.get("docUrl") ?? "").trim();
    const { version, days } = await importCadenceDoc(user.id, url);
    await saveAppSettings({ ...(await getAppSettings()), cadenceDocUrl: url });
    refresh();
    return { ok: true, message: `Imported template v${version} for Day ${days.join(", ")}` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

