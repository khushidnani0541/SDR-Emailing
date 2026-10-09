import { OAuth2Client } from "google-auth-library";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { db, schema } from "@/db";
import { decrypt } from "./crypto";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.compose", // create + send drafts
  "https://www.googleapis.com/auth/gmail.readonly", // reply / bounce detection
  "https://www.googleapis.com/auth/spreadsheets.readonly", // prospect sheet import
  "https://www.googleapis.com/auth/documents.readonly", // cadence doc import
];

export function redirectUri(): string {
  return `${env().APP_URL}/api/auth/google/callback`;
}

export function oauthClient(): OAuth2Client {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env();
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)");
  }
  return new OAuth2Client({ clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, redirectUri: redirectUri() });
}

export function hasAllScopes(granted: string | null | undefined): boolean {
  const set = new Set((granted ?? "").split(/\s+/));
  return GOOGLE_SCOPES.filter((s) => s.startsWith("https://")).every((s) => set.has(s));
}

/** An authorized client for an SDR, used by both the web app and the worker. */
export async function clientForUser(userId: string): Promise<OAuth2Client> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user?.refreshTokenEnc) throw new Error("Google account is not connected for this SDR");
  const client = oauthClient();
  client.setCredentials({ refresh_token: decrypt(user.refreshTokenEnc) });
  return client;
}
