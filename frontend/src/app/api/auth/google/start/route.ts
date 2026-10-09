import { randomBytes } from "node:crypto";
import { connection, NextResponse } from "next/server";
import { GOOGLE_SCOPES, oauthClient } from "@/auth/google";
import { getSession } from "@/auth/session";
import { env } from "@/lib/env";

export async function GET() {
  await connection(); // always per-request (sets an OAuth state cookie)
  try {
    const session = await getSession();
    session.oauthState = randomBytes(16).toString("hex");
    await session.save();
    const url = oauthClient().generateAuthUrl({
      access_type: "offline", // refresh token for the worker (morning runs, timed sends)
      prompt: "consent",
      include_granted_scopes: true,
      scope: GOOGLE_SCOPES,
      state: session.oauthState,
      hd: env().ALLOWED_EMAIL_DOMAIN || undefined,
    });
    return NextResponse.redirect(url);
  } catch (err) {
    console.error("[auth] start failed", err);
    const message = err instanceof Error ? err.message : "Sign-in is unavailable";
    return NextResponse.redirect(`${env().APP_URL}/login?error=${encodeURIComponent(message)}`);
  }
}
