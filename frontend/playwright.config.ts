import { defineConfig, devices } from "@playwright/test";
import { E2E_ENV, E2E_PORT, STATE_FILE } from "./src/tests/e2e/env";

export default defineConfig({
  testDir: "./src/tests/e2e",
  testMatch: "*.spec.ts",
  globalSetup: "./src/tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    storageState: STATE_FILE,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Production server from `next build`, pointed at the throwaway test database.
    command: `npx next start -p ${E2E_PORT}`,
    url: `http://localhost:${E2E_PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...E2E_ENV, LIBRARIAN_MCP_URL: process.env.LIBRARIAN_MCP_URL ?? "https://example.invalid/mcp" },
  },
});
