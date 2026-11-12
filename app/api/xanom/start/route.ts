import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { db } from "@/lib/env";
import { IOS_CALLBACK, xanomConfig } from "@/lib/xanom/config";
import { authorizeUrl, convertTicket, FLOW_COOKIE, FLOW_TTL_MS, newFlow, safeReturn, sealFlow, type Platform } from "@/lib/xanom/flow";
import type { Intent } from "@/lib/xanom/link";
import { redeemTicket } from "@/lib/xanom/tickets";

const INTENTS: Intent[] = ["signin", "link", "convert"];

/** Where a failed start lands: the sign-in or account page on the web, or the app on iOS. */
function fail(req: NextRequest, platform: Platform, intent: Intent, code: string): NextResponse {
  if (platform === "ios") return NextResponse.redirect(`${IOS_CALLBACK}?error=${code}`, 302);
  const page = intent === "signin" ? "/signin" : "/account";
  return NextResponse.redirect(new URL(`${page}?xanom_error=${code}`, req.url), 302);
}

/**
 * Starts "Continue with Xanom" (xanom-accounts SPEC §2): remembers state, PKCE and nonce in a signed cookie and
 * sends the browser to accounts.xanom.co. `intent=link|convert` needs a signed-in voter; the iOS app proves that with
 * a one-time `ticket` from /api/xanom/ios-ticket because its session isn't in the browser.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const intent = (INTENTS as string[]).includes(q.get("intent") ?? "") ? (q.get("intent") as Intent) : "signin";
  const platform: Platform = q.get("platform") === "ios" ? "ios" : "web";
  const config = xanomConfig();
  if (!config) return fail(req, platform, intent, "unavailable");

  const now = Date.now();
  let user: { id: string; email: string } | null = null;
  if (intent !== "signin") {
    if (platform === "ios") {
      const started = await redeemTicket(db(), ["ios-start"], q.get("ticket") ?? "", now);
      user = started ? await db().prepare("SELECT id, email FROM users WHERE id = ?").bind(started.userId).first<{ id: string; email: string }>() : null;
    } else {
      user = await currentUser();
    }
    if (!user) {
      if (platform === "ios") return fail(req, platform, intent, "signed-out");
      return NextResponse.redirect(new URL("/signin?next=/account", req.url), 302);
    }
  }

  const fallback = intent === "signin" ? "/" : "/account";
  const flow = newFlow(intent, platform, safeReturn(q.get("return"), fallback), user?.id ?? null, now);
  let convert: string | undefined;
  if (intent === "convert" && user) {
    const row = await db().prepare("SELECT email_verified_at FROM users WHERE id = ?").bind(user.id).first<{ email_verified_at: number | null }>();
    // Ballotwise doesn't ask for names, so the ticket's name is empty and Xanom asks for one if it needs it.
    convert = await convertTicket(config, { email: user.email, name: "", emailVerified: row?.email_verified_at != null }, now);
  }

  const res = NextResponse.redirect(authorizeUrl(config, flow, { convert, loginHint: intent === "convert" ? user?.email : undefined }), 302);
  res.cookies.set(FLOW_COOKIE, sealFlow(flow, config.clientSecret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/xanom",
    maxAge: FLOW_TTL_MS / 1000,
  });
  res.headers.set("cache-control", "no-store");
  return res;
}
