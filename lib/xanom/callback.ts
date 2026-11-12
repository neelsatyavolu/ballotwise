import type { JWTVerifyGetKey } from "jose";
import type { Db } from "../auth/accounts";
import { exchangeCode, openFlow, stateMatches, verifyIdToken, type Platform, type XanomConfig } from "./flow";
import { linkXanom, LinkError, type Intent } from "./link";
import { issueTicket } from "./tickets";

export type CallbackResult =
  | { ok: true; platform: "web"; userId: string; returnTo: string }
  | { ok: true; platform: "ios"; ticket: string }
  | { ok: false; platform: Platform; intent: Intent; code: string };

type Deps = { db: Db; config: XanomConfig; keys: JWTVerifyGetKey; fetcher?: typeof fetch; now: number };

/**
 * Finishes the Xanom flow: checks the signed flow cookie and state, trades the code (with the PKCE verifier),
 * verifies the id_token (signature, iss, aud, exp, nonce) and applies the linking rules.
 * On the web the caller starts a session for `userId`; for iOS it hands the app a one-time ticket.
 */
export async function completeCallback(deps: Deps, cookie: string | undefined, params: URLSearchParams): Promise<CallbackResult> {
  const flow = openFlow(cookie, deps.config.clientSecret, deps.now);
  if (!flow) return { ok: false, platform: "web", intent: "signin", code: "expired" };
  const failed = (code: string): CallbackResult => ({ ok: false, platform: flow.platform, intent: flow.intent, code });
  if (!stateMatches(flow, params.get("state"))) return failed("state");
  const error = params.get("error");
  if (error) return failed(error === "access_denied" ? "cancelled" : "failed");
  const code = params.get("code");
  if (!code) return failed("failed");

  let who: { sub: string; email: string };
  try {
    const idToken = await exchangeCode(deps.config, code, flow.verifier, deps.fetcher);
    who = await verifyIdToken(deps.config, idToken, flow.nonce, deps.keys);
  } catch (err) {
    console.error("xanom callback: sign-in failed:", err instanceof Error ? err.message : "unknown");
    return failed("failed");
  }

  try {
    const user = await linkXanom(deps.db, who, flow.intent, flow.userId, deps.now);
    if (flow.platform === "ios") return { ok: true, platform: "ios", ticket: await issueTicket(deps.db, "ios-session", user.id, deps.now) };
    return { ok: true, platform: "web", userId: user.id, returnTo: flow.intent === "signin" ? flow.returnTo : withParam(flow.returnTo, "xanom", "linked") };
  } catch (err) {
    if (err instanceof LinkError) return failed(err.code);
    throw err;
  }
}

function withParam(path: string, key: string, value: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${value}`;
}
