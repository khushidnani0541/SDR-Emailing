import { describe, expect, it } from "vitest";
import { checkEmail } from "./guardrails";

const base = { day: 4, subject: null, knownClients: [], referenceableClients: [] };

describe("email guardrails", () => {
  it("passes a clean follow-up", () => {
    expect(checkEmail({ ...base, body: "Hi Asha, one more idea on kiln energy. Worth a look?" })).toEqual({ errors: [], warnings: [] });
  });
  it("blocks leftover placeholders and missing Day 1 subject", () => {
    const r = checkEmail({ ...base, day: 1, subject: "", body: "Hi {{first_name}}, quick note" });
    expect(r.errors).toEqual(["Day 1 email needs a subject line", "Contains an unfilled placeholder"]);
  });
  it("warns on pricing language and money figures", () => {
    const r = checkEmail({ ...base, body: "Our pricing starts at ₹2 lakh per plant." });
    expect(r.warnings.some((w) => w.includes("pricing"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("money figure"))).toBe(true);
  });
  it("warns when a non-referenceable client is named", () => {
    const r = checkEmail({
      ...base,
      body: "We helped UltraTech and JSW Cement cut power costs.",
      knownClients: ["UltraTech Cement", "UltraTech", "JSW Cement"],
      referenceableClients: ["JSW Cement"],
    });
    expect(r.warnings).toContain("Names client(s) not on the referenceable list: UltraTech");
  });
  it("flags long emails", () => {
    const r = checkEmail({ ...base, day: 12, body: "word ".repeat(120) });
    expect(r.warnings[0]).toMatch(/Long for a Day 12 email \(120 words/);
  });
});
