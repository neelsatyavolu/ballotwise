import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { startSession } from "@/lib/auth/accounts";
import { accountFailure } from "@/lib/auth/respond";
import { currentUser, setAccountCookie } from "@/lib/auth/session";
import { db } from "@/lib/env";
import { linkXanom } from "@/lib/xanom/link";
import { redeemTicket } from "@/lib/xanom/tickets";

const bodySchema = z.object({ ticket: z.string().min(1).max(100) });

/**
 * The iOS app trades the one-time ticket from ballotwise://xanom (xanom-accounts SPEC §5).
 * After a sign-in it gets its session: the same `bw_session` cookie the app already keeps in its cookie store.
 * After a link or convert, the Xanom identity is attached here, and only if this request's own session is the
 * voter who started it.
 */
export async function POST(req: NextRequest) {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "That sign-in link is incomplete. Try again." }, { status: 400 });
  const now = Date.now();
  const redeemed = await redeemTicket(db(), ["ios-session", "ios-link"], body.data.ticket, now);
  if (!redeemed) return NextResponse.json({ error: "That sign-in expired or was already used. Try again." }, { status: 401 });

  if (redeemed.kind === "ios-link") {
    const current = await currentUser();
    if (!redeemed.link || current?.id !== redeemed.userId) {
      return NextResponse.json({ error: "Your session ended. Sign in and try again." }, { status: 401 });
    }
    try {
      const user = await linkXanom(db(), redeemed.link, redeemed.link.intent, current.id, now);
      return NextResponse.json({ user });
    } catch (err) {
      return accountFailure(err);
    }
  }

  const user = await db().prepare("SELECT id, email FROM users WHERE id = ?").bind(redeemed.userId).first<{ id: string; email: string }>();
  if (!user) return NextResponse.json({ error: "That account no longer exists." }, { status: 401 });
  await setAccountCookie(await startSession(db(), user.id, now));
  return NextResponse.json({ user });
}
