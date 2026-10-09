import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const SHOTS = "test-results/screenshots";
mkdirSync(SHOTS, { recursive: true });

/** Fails the test on any browser console error or uncaught page error. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("redirects to login", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("link", { name: "Continue with Google" })).toBeVisible();
    await shot(page, "01-login");
    expect(errors).toEqual([]);
  });
});

test.describe("signed in SDR", () => {
  test("today: review queue shows drafts, guardrail warnings and gated approval", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Day 1 · First touch/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Asha Rao/ })).toBeVisible();
    await expect(page.getByText(/Mentions pricing\/commercial terms/)).toBeVisible();
    await expect(page.getByText(/Names client\(s\) not on the referenceable list/)).toBeVisible();
    // Gmail not connected -> approve is disabled with a hint.
    await expect(page.getByRole("button", { name: /Approve & queue 3 in Gmail/ })).toBeDisabled();
    await expect(page.getByText("Connect Gmail in Settings to approve.")).toBeVisible();
    // Call list with phone and opener from person research.
    await expect(page.getByText(/curious how you're planning to keep power per tonne flat/)).toBeVisible();
    await expect(page.getByRole("link", { name: "+1 574-340-0023" })).toBeVisible();
    // Day 6 LinkedIn task with the doc's connection note, first name filled in.
    await expect(page.getByLabel("Connection request message")).toHaveText(/^Hi Asha, we help manufacturing companies/);
    await page.getByRole("button", { name: "Request sent" }).click();
    await expect(page.getByLabel("Connection request message")).toHaveCount(0);
    await shot(page, "02-today");
    expect(errors).toEqual([]);
  });

  test("today: edit a draft and persist it", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto("/");
    await page.getByRole("button", { name: /Meera Shah/ }).click();
    const body = page.getByLabel("Email body");
    await body.fill("Hi Meera,\n\nEdited by the SDR in review.\n\nBest,");
    await page.getByRole("button", { name: "Save edits" }).click();
    await expect(page.getByText(/Edited by the SDR in review/).first()).toBeVisible();
    await page.reload();
    await expect(page.getByText(/Edited by the SDR in review/).first()).toBeVisible();
    await shot(page, "03-edit");
    expect(errors).toEqual([]);
  });

  test("today: skip an email removes it from review", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto("/");
    await page.getByRole("button", { name: /Ravi Kumar/ }).click();
    await page.getByRole("button", { name: "Skip this email" }).click();
    await expect(page.getByRole("button", { name: /Ravi Kumar/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Day 1 · First touch/ })).toContainText("2");
    expect(errors).toEqual([]);
  });

  test("calls: logging 'meeting booked' stops the cadence", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto("/");
    await page.getByLabel("Call outcome").selectOption("meeting_booked");
    await page.getByLabel("Call notes").fill("Booked for Thursday");
    await page.getByRole("button", { name: "Log call" }).click();
    await expect(page.getByText("No calls or LinkedIn tasks due today.")).toBeVisible();
    // Her pending Day 1 email is cancelled along with the cadence.
    await expect(page.getByRole("button", { name: /Meera Shah/ })).toHaveCount(0);
    await page.goto("/prospects?status=meeting_booked");
    await expect(page.getByRole("link", { name: "Meera Shah" })).toBeVisible();
    await shot(page, "04-prospects-meeting-booked");
    expect(errors).toEqual([]);
  });

  test("prospect detail shows company, person and industry research", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto("/prospects");
    await page.getByRole("link", { name: "Asha Rao" }).click();
    await expect(page.getByRole("heading", { name: "Asha Rao" })).toBeVisible();
    await expect(page.getByText("Announced a 2 MTPA brownfield line [fixture]")).toBeVisible();
    await expect(page.getByText("Energy Management System", { exact: true })).toBeVisible();
    await expect(page.getByText(/Keeping power cost per tonne down/)).toBeVisible();
    await expect(page.getByRole("heading", { name: /Industry brief · Cement/ })).toBeVisible();
    await shot(page, "05-prospect-detail");
    expect(errors).toEqual([]);
  });

  test("industries page lists the brief with evidence levels", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto("/industries");
    await page.getByText("Cement", { exact: true }).click();
    await expect(page.getByText("Kiln SHC optimiser")).toBeVisible();
    await expect(page.getByText("UltraTech Cement · proposal")).toBeVisible();
    await shot(page, "06-industries");
    expect(errors).toEqual([]);
  });

  test("costs page totals the usage log", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto("/costs");
    // 0.034 + 0.115 + 0.0059 = 0.1549
    await expect(page.locator("p", { hasText: /^\$0\.155$/ })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Company research" })).toBeVisible();
    await expect(page.getByText(/1 in this range/)).toBeVisible();
    await page.getByRole("link", { name: "Last 7 days" }).click();
    await expect(page.getByRole("heading", { name: "Daily model cost" })).toBeVisible();
    await shot(page, "07-costs");
    expect(errors).toEqual([]);
  });

  test("settings: cadence templates, case-study files and saving", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto("/settings");
    await page.getByText(/Current templates \(built-in copy of the SDR Cadence doc\)/).click();
    await expect(page.getByText(/I’ve tried calling\./)).toBeVisible();
    await expect(page.getByText("Day 6 · LinkedIn connection request")).toBeVisible();
    await expect(page.getByText(/Attachments off/)).toBeVisible();
    await page.getByLabel("File URL pattern").fill("https://files.example.com/{id}.pdf");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Attachments on (URL pattern)")).toBeVisible();
    await page.getByLabel("Email signature").fill("Fixture SDR\nFaclon Labs");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved")).toBeVisible();
    await page.getByLabel("Clients we may name in emails").fill("JSW Cement");
    await page.getByRole("button", { name: "Save list" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await shot(page, "08-settings");
    expect(errors).toEqual([]);
  });

  test("upload: CSV rows without email are skipped before any research", async ({ page }) => {
    const errors = watchConsole(page);
    const csv = "Name,Title,Company,LinkedIn,Email\nNina Patel,CTO,Example Steel Ltd,,nina.patel@example.com\nNo Email,GM,Example Steel Ltd,,\n";
    const file = "test-results/upload.csv";
    writeFileSync(file, csv);
    await page.goto("/upload");
    await page.getByRole("tab", { name: "CSV / Excel file" }).click();
    await page.getByLabel("File").setInputFiles(file);
    await page.getByRole("button", { name: "Start research" }).click();
    await expect(page.getByText("1 prospect queued for research.", { exact: false })).toBeVisible();
    await page.getByText("1 row skipped").click();
    await expect(page.getByText(/No Email, Example Steel Ltd — No email address/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent uploads" })).toBeVisible();
    await shot(page, "09-upload");
    expect(errors).toEqual([]);
  });
});
