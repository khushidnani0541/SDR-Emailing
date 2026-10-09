import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DraftInput } from "./draft";
import { DEFAULT_TEMPLATES, splitCadenceDoc } from "./templates";

vi.mock("@/db", () => ({ db: {}, schema: {} }));

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://unused";
  process.env.LIBRARIAN_MCP_URL ??= "https://example.invalid/mcp";
  process.env.SESSION_SECRET ??= "x".repeat(32);
  process.env.TOKEN_ENCRYPTION_KEY ??= "0".repeat(64);
});

const input: DraftInput = {
  day: 4,
  prospect: { name: "Asha Rao", title: "Plant Head", companyName: "Acme Cement", callNotes: null },
  industryKey: "manufacturing/cement",
  brief: null,
  company: {
    key: "acme-cement",
    displayName: "Acme Cement",
    industryKey: "manufacturing/cement",
    research: {
      confirmedIndustryKey: "manufacturing/cement",
      website: null,
      description: "Cement maker",
      size: { employees: null, revenue: null, band: "unknown" },
      locations: { hq: null, plants: [] },
      likelyMachinesAndProcesses: ["kiln"],
      signals: [],
      digitalMaturity: { level: 2, evidence: "none" },
      firstValueWedge: { offering: "EnMS", why: "power", likelyBuyer: "Plant Head" },
      sources: [],
    },
  },
  person: null,
  previousEmails: [{ day: 1, subject: "Power at Acme", body: "Hi Asha, ..." }],
};

describe("draft request", () => {
  it("puts stable content first with cache breakpoints, prospect specifics last", async () => {
    const { buildDraftRequest } = await import("./draft");
    const req = buildDraftRequest(input, { version: 0, byDay: DEFAULT_TEMPLATES });
    const system = req.system as { text: string; cache_control?: unknown }[];
    expect(system).toHaveLength(1);
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(system[0].text).toContain("### Day 12 email guidelines");
    expect(system[0].text).not.toContain("Asha"); // nothing prospect-specific in the shared prefix

    const content = req.messages[0].content as { text: string; cache_control?: unknown }[];
    expect(content[0].text).toMatch(/^## Industry brief/);
    expect(content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(content[1].cache_control).toBeUndefined();
    expect(content[1].text).toContain("--- Day 1 (subject: Power at Acme) ---");
    expect(content[1].text).toContain("Write the Day 4 email.");
  });

  it("forces follow-ups to have no subject (they reply in the Day 1 thread)", async () => {
    const { parseDraftMessage } = await import("./draft");
    const message = {
      content: [{ type: "text", text: JSON.stringify({ subject: "New subject", body: " Hi Asha ", rationale: "r", proofPointsUsed: [] }) }],
    } as never;
    expect(parseDraftMessage(message, 4)).toMatchObject({ subject: null, body: "Hi Asha" });
  });
});

describe("cadence doc import", () => {
  it("splits a doc into Day 1/4/7/12 sections and ignores other days", () => {
    const doc = "Intro text\nDay 1 - Email\nOpen with the call.\nDay 3 - Call script\nSay hi.\nDay 4: Email\nNew angle.\n## Day 7\nShare a case study.\nDay 12 (break-up)\nClose the loop.";
    expect(splitCadenceDoc(doc)).toEqual({
      1: "Open with the call.",
      4: "New angle.",
      7: "Share a case study.",
      12: "Close the loop.",
    });
  });
});
