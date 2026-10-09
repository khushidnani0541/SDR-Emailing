import { describe, expect, it } from "vitest";
import { companyKey, detectColumns, normalizeLinkedin, parseRows } from "./parse";

describe("column detection", () => {
  it("maps common header variants", () => {
    expect(detectColumns(["Prospect Name", "Designation", "Company Name", "LinkedIn Profile URL", "Email ID"])).toEqual({
      name: 0,
      title: 1,
      company: 2,
      linkedin: 3,
      email: 4,
    });
  });
});

describe("Apollo-style export (Yash's sheet)", () => {
  it("maps Person Linkedin Url, phones, state and time zone but not Company Linkedin Url", () => {
    const header = ["First Name", "Last Name", "Title", "Company Name", "Email", "Work Direct Phone", "Mobile Phone", "Person Linkedin Url", "Company Linkedin Url", "Company State", "US Time Zone"];
    const { prospects } = parseRows([
      header,
      ["Cory", "Smith", "Production Supervisor", "BCI Solutions, Inc.", "csmith@example.com", "", "+1 574-340-0023", "http://www.linkedin.com/in/cory-smith-65434173", "https://linkedin.com/company/bci", "Indiana", "E"],
    ]);
    expect(prospects[0]).toMatchObject({
      name: "Cory Smith",
      companyKey: "bci-solutions",
      linkedinUrl: "https://www.linkedin.com/in/cory-smith-65434173",
      phone: "+1 574-340-0023",
      location: "Indiana",
      timeZone: "E",
    });
  });
});

describe("normalization", () => {
  it("collapses company suffix variants to one key", () => {
    expect(companyKey("JSW Steel Ltd.")).toBe("jsw-steel");
    expect(companyKey("JSW Steel Limited")).toBe("jsw-steel");
    expect(companyKey("Tata Motors Pvt. Ltd")).toBe("tata-motors");
  });
  it("canonicalizes LinkedIn URLs", () => {
    expect(normalizeLinkedin("linkedin.com/in/Jane-Doe-123/?utm=x")).toBe("https://www.linkedin.com/in/jane-doe-123");
    expect(normalizeLinkedin("https://www.linkedin.com/company/acme")).toBeNull();
    expect(normalizeLinkedin("")).toBeNull();
  });
});

describe("row parsing", () => {
  const header = ["Name", "Title", "Company", "LinkedIn", "Email"];
  it("skips rows without email, duplicates and active prospects before any research", () => {
    const { prospects, skipped } = parseRows(
      [
        header,
        ["Asha Rao", "Plant Head", "Acme Cement Ltd", "https://linkedin.com/in/asha", "asha@acme.com"],
        ["No Mail", "VP Ops", "Acme Cement", "", ""],
        ["Asha Rao", "Plant Head", "Acme Cement", "", "ASHA@acme.com"],
        ["Ravi K", "CTO", "Beta Steel", "", "ravi@beta.com"],
        ["", "", "", "", ""],
        ["Bad Mail", "GM", "Gamma", "", "not-an-email"],
      ],
      { activeEmails: new Map([["ravi@beta.com", "sdr2@faclon.com"]]) },
    );
    expect(prospects).toHaveLength(1);
    expect(prospects[0]).toMatchObject({ companyKey: "acme-cement", personKey: "https://www.linkedin.com/in/asha" });
    expect(skipped.map((s) => [s.row, s.reason])).toEqual([
      [3, "No email address"],
      [4, "Duplicate of an earlier row"],
      [5, "Already in an active cadence (sdr2@faclon.com)"],
      [7, 'Invalid email "not-an-email"'],
    ]);
  });
  it("combines first and last name columns", () => {
    const { prospects } = parseRows([
      ["First Name", "Last Name", "Company", "Work Email"],
      ["Meera", "Shah", "Delta Pharma", "meera@delta.com"],
    ]);
    expect(prospects[0].name).toBe("Meera Shah");
    expect(prospects[0].personKey).toBe("email:meera@delta.com");
  });
  it("rejects sheets missing required columns", () => {
    expect(() => parseRows([["Name", "Company"]])).toThrow(/Email/);
  });
});
