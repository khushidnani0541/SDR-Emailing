import { randomBytes } from "node:crypto";

export const E2E_PORT = 3100;
export const E2E_DB_URL = "postgres://sdr@127.0.0.1:5433/sdr_cadence_test";
export const STATE_FILE = "test-results/e2e-auth.json";

// Test-only secrets, generated per run (never the real ones in .env.local).
const secret = process.env.E2E_SESSION_SECRET ?? randomBytes(32).toString("hex");
process.env.E2E_SESSION_SECRET = secret;

export const E2E_ENV = {
  DATABASE_URL: E2E_DB_URL,
  APP_URL: `http://localhost:${E2E_PORT}`,
  SESSION_SECRET: secret,
  TOKEN_ENCRYPTION_KEY: "0".repeat(64),
  SEND_MODE: "draft_only",
  RUN_WORKER_IN_APP: "false",
};
