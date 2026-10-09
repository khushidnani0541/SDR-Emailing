import { describe, expect, it } from "vitest";
import { attachmentsConfigured, parseDocUrlLines, resolveAttachmentUrl } from "./case-studies";
import { checkEmail } from "@/services/drafting/guardrails";
import { buildMime } from "@/services/gmail/mime";

describe("case-study attachment config", () => {
  it("is off until a pattern or explicit file is configured", () => {
    expect(attachmentsConfigured(undefined)).toBe(false);
    expect(attachmentsConfigured({ urlTemplate: "https://files.example.com/doc" })).toBe(false); // no {id}
    expect(attachmentsConfigured({ urlTemplate: "https://files.example.com/{id}.pdf" })).toBe(true);
    expect(attachmentsConfigured({ byDocId: { "cs-1": "https://x.example.com/cs1.pdf" } })).toBe(true);
  });
  it("prefers explicit URLs, then the pattern", () => {
    const cfg = { urlTemplate: "https://files.example.com/{id}/download", byDocId: { "cs-1": "https://x.example.com/cs1.pdf" } };
    expect(resolveAttachmentUrl(cfg, "cs-1")).toBe("https://x.example.com/cs1.pdf");
    expect(resolveAttachmentUrl(cfg, "jsw dolvi")).toBe("https://files.example.com/jsw%20dolvi/download");
  });
  it("parses the settings textarea", () => {
    expect(parseDocUrlLines("cs-1 = https://a.example.com/1.pdf\nbad line\n cs-2=https://a.example.com/2.pdf ")).toEqual({
      "cs-1": "https://a.example.com/1.pdf",
      "cs-2": "https://a.example.com/2.pdf",
    });
  });
});

describe("attachment guardrail", () => {
  const base = { day: 4, subject: null, knownClients: [], referenceableClients: [] };
  it("blocks 'attached' claims without a file", () => {
    expect(checkEmail({ ...base, body: "The case study is attached. Thoughts?" }).errors[0]).toMatch(/no file is configured/);
    expect(checkEmail({ ...base, body: "The case study is attached. Thoughts?", hasAttachment: true }).errors).toEqual([]);
    expect(checkEmail({ ...base, body: "Happy to send over the case study." }).errors).toEqual([]);
  });
});

describe("multipart MIME", () => {
  it("attaches files after the text part", () => {
    const mime = buildMime(
      {
        from: { name: "Yash", email: "yash.a@faclon.com" },
        to: { name: "Cory", email: "cory@example.com" },
        subject: "Re: Plant data",
        body: "Hi Cory,\nThe case study is attached.\nBest,",
        attachments: [{ filename: "JSW Dolvi.pdf", mimeType: "application/pdf", data: Buffer.from("%PDF-1.4 test") }],
      },
      "BOUNDARY",
    );
    expect(mime).toContain('Content-Type: multipart/mixed; boundary="BOUNDARY"');
    expect(mime).toContain('Content-Disposition: attachment; filename="JSW Dolvi.pdf"');
    expect(mime.trim().endsWith("--BOUNDARY--")).toBe(true);
    const pdfPart = mime.split("--BOUNDARY")[2].split("\r\n\r\n")[1].replace(/\r\n/g, "");
    expect(Buffer.from(pdfPart, "base64").toString()).toBe("%PDF-1.4 test");
  });
});
