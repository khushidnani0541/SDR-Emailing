import { google } from "googleapis";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import { clientForUser } from "@/auth/google";

/** Extracts spreadsheet id and tab gid from a Google Sheets URL. */
export function parseSheetUrl(url: string): { spreadsheetId: string; gid: number | null } | null {
  const id = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1];
  if (!id) return null;
  const gid = url.match(/[#&?]gid=(\d+)/)?.[1];
  return { spreadsheetId: id, gid: gid ? Number(gid) : null };
}

/** Reads a Google Sheet tab (the one in the URL, else the first) with the SDR's own Google access. */
export async function readGoogleSheet(userId: string, url: string): Promise<string[][]> {
  const parsed = parseSheetUrl(url);
  if (!parsed) throw new Error("That doesn't look like a Google Sheets link");
  const sheets = google.sheets({ version: "v4", auth: await clientForUser(userId) });
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: parsed.spreadsheetId, fields: "sheets.properties" });
    const tabs = meta.data.sheets ?? [];
    const tab = tabs.find((s) => s.properties?.sheetId === parsed.gid) ?? tabs[0];
    const title = tab?.properties?.title;
    if (!title) throw new Error("The spreadsheet has no tabs");
    const values = await sheets.spreadsheets.values.get({
      spreadsheetId: parsed.spreadsheetId,
      range: `'${title.replace(/'/g, "''")}'`,
      valueRenderOption: "FORMATTED_VALUE",
    });
    return (values.data.values ?? []).map((r) => r.map((c) => String(c ?? "")));
  } catch (err: unknown) {
    const status = (err as { code?: number }).code;
    if (status === 403 || status === 404) {
      throw new Error("Couldn't open that sheet. Make sure your Google account has access to it.");
    }
    throw err;
  }
}

export function readCsv(text: string): string[][] {
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  if (result.errors.length && !result.data.length) throw new Error(`Could not parse CSV: ${result.errors[0].message}`);
  return result.data.map((r) => r.map((c) => String(c ?? "")));
}

export async function readXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("The workbook has no sheets");
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    row.eachCell({ includeEmpty: true }, (c, col) => {
      const v = c.value;
      const text =
        v && typeof v === "object" && "hyperlink" in v
          ? String((v as { hyperlink: string; text?: string }).hyperlink)
          : v && typeof v === "object" && "text" in v
            ? String((v as { text: string }).text)
            : c.text;
      values[col - 1] = (text ?? "").trim();
    });
    rows.push(Array.from(values, (x) => x ?? ""));
  });
  return rows;
}
