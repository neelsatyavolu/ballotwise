import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { startSession } from "@/lib/auth/accounts";
import { setAccountCookie } from "@/lib/auth/session";
import { db } from "@/lib/env";
import { redeemTicket } from "@/lib/xanom/tickets";

const bodySchema = z.object({ ticket: z.string().min(1).max(100) });

/**
 * The iOS app trades the one-time ticket from ballotwise://xanom for its session (xanom-accounts SPEC §5).
 * The session is the same `bw_session` cookie the app already keeps in its cookie store.
 */
export async function POST(req: NextRequest) {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "That sign-in link is incomplete. Try again." }, { status: 400 });
  const now = Date.now();
  const userId = await redeemTicket(db(), "ios-session", body.data.ticket, now);
  if (!userId) return NextResponse.json({ error: "That sign-in expired or was already used. Try again." }, { status: 401 });
  const user = await db().prepare("SELECT id, email FROM users WHERE id = ?").bind(userId).first<{ id: string; email: string }>();
  if (!user) return NextResponse.json({ error: "That account no longer exists." }, { status: 401 });
  await setAccountCookie(await startSession(db(), user.id, now));
  return NextResponse.json({ user });
}
