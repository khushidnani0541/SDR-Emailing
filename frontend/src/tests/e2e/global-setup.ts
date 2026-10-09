import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { sealData } from "iron-session";
import { Client } from "pg";
import { seed } from "./seed";
import { E2E_DB_URL, E2E_ENV, STATE_FILE } from "./env";

/** Recreates the throwaway test database, applies the schema, seeds fixtures and writes a signed-in browser state. */
export default async function globalSetup() {
  const admin = new Client({ connectionString: E2E_DB_URL.replace(/\/[^/]+$/, "/postgres") });
  await admin.connect();
  await admin.query("drop database if exists sdr_cadence_test with (force)");
  await admin.query("create database sdr_cadence_test");
  await admin.end();

  execSync("npx drizzle-kit push --force", { env: { ...process.env, DATABASE_URL: E2E_DB_URL }, stdio: "ignore" });
  const { userId } = await seed(E2E_DB_URL);

  const cookie = await sealData({ userId }, { password: E2E_ENV.SESSION_SECRET });
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    STATE_FILE,
    JSON.stringify({
      cookies: [{ name: "sdr_session", value: cookie, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax", expires: -1 }],
      origins: [],
    }),
  );
}
