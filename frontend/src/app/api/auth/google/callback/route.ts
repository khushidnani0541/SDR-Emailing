import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { hasAllScopes, oauthClient } from "@/auth/google";
import { encrypt } from "@/auth/crypto";
import { getSession } from "@/auth/session";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { rosterEntry } from "@/lib/sdr-roster";

function fail(message: string) {
  return NextResponse.redirect(`${env().APP_URL}/login?error=${encodeURIComponent(message)}`);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const session = await getSession();
  if (params.get("error")) return fail(`Google sign-in was cancelled (${params.get("error")})`);
  const code = params.get("code");
  if (!code || !params.get("state") || params.get("state") !== session.oauthState) {
    return fail("Sign-in expired, please try again");
  }

  try {
    const client = oauthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) return fail("Google did not return an identity token");
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env().GOOGLE_CLIENT_ID });
    const claims = ticket.getPayload();
    if (!claims?.email || !claims.email_verified) return fail("Your Google email is not verified");

    const domain = env().ALLOWED_EMAIL_DOMAIN;
    if (domain && claims.hd !== domain) return fail(`Please sign in with your @${domain} account`);
    const sdr = rosterEntry(claims.email);
    if (!sdr) return fail(`${claims.email} is not on the SDR list for this app`);

    const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, claims.email));
    // Google only returns a refresh token on consent; keep the stored one otherwise.
    const refreshTokenEnc = tokens.refresh_token ? encrypt(tokens.refresh_token) : existing?.refreshTokenEnc ?? null;
    const scopes = tokens.scope ?? existing?.grantedScopes ?? "";
    const values = {
      email: claims.email,
      name: sdr.name,
      googleSub: claims.sub,
      refreshTokenEnc,
      grantedScopes: scopes,
      gmailConnected: !!refreshTokenEnc && hasAllScopes(scopes),
      updatedAt: new Date(),
    };

    const [user] = existing
      ? await db.update(schema.users).set(values).where(eq(schema.users.id, existing.id)).returning()
      : await db.insert(schema.users).values(values).returning();

    session.userId = user.id;
    session.oauthState = undefined;
    await session.save();
    return NextResponse.redirect(`${env().APP_URL}/${user.gmailConnected ? "" : "settings?connect=1"}`);
  } catch (err) {
    console.error("[auth] callback failed", err);
    return fail("Could not complete Google sign-in");
  }
}
