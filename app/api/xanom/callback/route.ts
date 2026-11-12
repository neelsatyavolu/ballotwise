import { NextRequest, NextResponse } from "next/server";
import { startSession } from "@/lib/auth/accounts";
import { setAccountCookie } from "@/lib/auth/session";
import { db } from "@/lib/env";
import { completeCallback } from "@/lib/xanom/callback";
import { IOS_CALLBACK, xanomConfig } from "@/lib/xanom/config";
import { FLOW_COOKIE, issuerKeys } from "@/lib/xanom/flow";

/** accounts.xanom.co sends the browser back here with a code (xanom-accounts SPEC §2 and §5). */
export async function GET(req: NextRequest) {
  const config = xanomConfig();
  if (!config) return NextResponse.redirect(new URL("/signin?xanom_error=unavailable", req.url), 302);
  const now = Date.now();
  const result = await completeCallback(
    { db: db(), config, keys: issuerKeys(config.issuer), now },
    req.cookies.get(FLOW_COOKIE)?.value,
    req.nextUrl.searchParams,
  );

  let res: NextResponse;
  if (!result.ok) {
    res =
      result.platform === "ios"
        ? NextResponse.redirect(`${IOS_CALLBACK}?error=${encodeURIComponent(result.code)}`, 302)
        : NextResponse.redirect(new URL(`${result.intent === "signin" ? "/signin" : "/account"}?xanom_error=${encodeURIComponent(result.code)}`, req.url), 302);
  } else if (result.platform === "ios") {
    res = NextResponse.redirect(`${IOS_CALLBACK}?ticket=${result.ticket}`, 302);
  } else {
    await setAccountCookie(await startSession(db(), result.userId, now));
    res = NextResponse.redirect(new URL(result.returnTo, req.url), 302);
  }
  res.cookies.delete({ name: FLOW_COOKIE, path: "/api/xanom" });
  res.headers.set("cache-control", "no-store");
  return res;
}
