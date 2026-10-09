import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "./session";

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  gmailConnected: boolean;
  settings: schema.SdrSettings;
};

/** Data access layer entry point: resolves the signed-in SDR or redirects to /login. */
export async function getCurrentUser(): Promise<CurrentUser> {
  // Session validation compares expiry with the current time and every page here is live,
  // per-SDR data, so this always runs at request time (never in a prefetch prerender).
  await connection();
  const session = await getSession();
  if (!session.userId) redirect("/login");
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) redirect("/login");
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    gmailConnected: user.gmailConnected,
    settings: user.settings,
  };
}
