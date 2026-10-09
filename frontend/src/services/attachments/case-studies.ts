import type { CaseStudyFileConfig } from "@/db/schema";

// Case-study attachments for Day 4. The Collateral Librarian currently serves document text only,
// so files are resolved through configuration (Settings -> Case study files):
//   1. an explicit URL for a document id, or
//   2. a URL pattern containing {id}, for when the Librarian exposes a file endpoint.
// When neither resolves, the email offers to send the case study instead of claiming it's attached.

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
};

export type AttachmentFile = { filename: string; mimeType: string; data: Buffer };

export function attachmentsConfigured(cfg: CaseStudyFileConfig | undefined): boolean {
  return !!cfg && (!!cfg.urlTemplate?.includes("{id}") || Object.keys(cfg.byDocId ?? {}).length > 0);
}

export function resolveAttachmentUrl(cfg: CaseStudyFileConfig | undefined, docId: string): string | null {
  if (!cfg) return null;
  const explicit = cfg.byDocId?.[docId];
  if (explicit) return explicit;
  if (cfg.urlTemplate?.includes("{id}")) return cfg.urlTemplate.replaceAll("{id}", encodeURIComponent(docId));
  return null;
}

/** Parses the Settings textarea format: one "doc-id = https://..." per line. */
export function parseDocUrlLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([^=\s]+)\s*=\s*(https?:\/\/\S+)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function slug(title: string): string {
  return title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "case-study";
}

/** Downloads a configured case-study file, refusing anything that isn't a small PDF/Office doc. */
export async function fetchAttachment(url: string, title: string): Promise<AttachmentFile> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: "follow" });
  if (!res.ok) throw new Error(`Case study download failed (HTTP ${res.status})`);
  const mimeType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = ALLOWED_TYPES[mimeType];
  if (!ext) throw new Error(`Case study URL returned ${mimeType || "an unknown type"}, expected a PDF, PPTX or DOCX`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_ATTACHMENT_BYTES) throw new Error("Case study file is larger than 10 MB");
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > MAX_ATTACHMENT_BYTES) throw new Error("Case study file is larger than 10 MB");
  const named = res.headers.get("content-disposition")?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];
  return { filename: named ? decodeURIComponent(named) : `${slug(title)}${ext}`, mimeType, data };
}
