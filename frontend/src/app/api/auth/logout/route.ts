import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { env } from "@/lib/env";

export async function POST() {
  const session = await getSession();
  session.destroy();
  return NextResponse.redirect(`${env().APP_URL}/login`, { status: 303 });
}
