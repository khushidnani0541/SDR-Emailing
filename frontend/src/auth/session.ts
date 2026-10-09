import "server-only";
import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { env } from "@/lib/env";

export type SessionData = { userId?: string; oauthState?: string };

function options(): SessionOptions {
  return {
    password: env().SESSION_SECRET,
    cookieName: "sdr_session",
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: env().APP_URL.startsWith("https://"),
      maxAge: 60 * 60 * 24 * 14,
    },
  };
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), options());
}
