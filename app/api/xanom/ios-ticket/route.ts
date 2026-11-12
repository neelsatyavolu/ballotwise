import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { db } from "@/lib/env";
import { issueTicket } from "@/lib/xanom/tickets";

/**
 * For link and convert from the iOS app: a one-time, 60-second ticket naming the signed-in voter, which the app
 * passes to /api/xanom/start inside the browser sheet, where its own session cookie isn't available.
 */
export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  return NextResponse.json({ ticket: await issueTicket(db(), "ios-start", user.id, Date.now()) });
}
