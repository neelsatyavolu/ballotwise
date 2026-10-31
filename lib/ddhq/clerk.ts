import { AccountError } from "../auth/accounts";
import type { DdhqSession } from "./vault";

const CLERK = "https://clerk.decisiondeskhq.com";
const ORIGIN = "https://votes.decisiondeskhq.com";
const JS = "5.128.0";

type ClerkBody = {
  errors?: { code?: string; message?: string; long_message?: string }[];
  response?: { id?: string; status?: string; created_session_id?: string | null; supported_first_factors?: { strategy?: string; email_address_id?: string }[] | null };
  meta?: { client?: { sign_in?: ClerkBody["response"] } };
  jwt?: string;
};

function clientToken(res: Response): string | null {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const cookie of list) {
    const match = /^__client=([^;]+)/.exec(cookie);
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

function signInOf(body: ClerkBody): NonNullable<ClerkBody["response"]> | null {
  return body.response ?? body.meta?.client?.sign_in ?? null;
}

function sessionJwt(body: ClerkBody): string | null {
  if (typeof body.jwt === "string" && body.jwt) return body.jwt;
  const nested = body.response as { jwt?: unknown } | undefined;
  return typeof nested?.jwt === "string" && nested.jwt ? nested.jwt : null;
}

function fail(body: ClerkBody, status: number, fallback: string): never {
  if (status === 429 || status >= 500) throw new AccountError("Decision Desk HQ didn't answer. Try again in a minute.", 502);
  const error = body.errors?.[0];
  const code = error?.code ?? "";
  if (code === "form_identifier_not_found") throw new AccountError("Decision Desk HQ has no account for that email.", 401);
  if (code === "form_code_incorrect" || code === "form_code_expired") throw new AccountError("That code doesn't match. Send a new one if it expired.", 401);
  if (code.includes("captcha")) throw new AccountError("Votes blocked this sign-in check. Try again in a minute.", 403);
  throw new AccountError(error?.long_message || error?.message || fallback, 401);
}

export type DdhqCode = { clientToken: string; signInId: string; emailAddressId: string };

/** Ask Votes to email a sign-in code. Nothing about the code is kept. */
export async function startVotesCode(email: string): Promise<DdhqCode> {
  const started = await clerk("/v1/client/sign_ins", new URLSearchParams({ identifier: email }), null);
  if (!started.res.ok) fail(started.json, started.res.status, "Decision Desk HQ didn't accept that email.");
  const attempt = signInOf(started.json);
  const factor = attempt?.supported_first_factors?.find((item) => item.strategy === "email_code" && item.email_address_id);
  if (!attempt?.id || !factor?.email_address_id || !started.client) {
    throw new AccountError("That Votes account doesn't email a sign-in code. It uses Google, X, The Hill, or only a password.", 400);
  }
  const prepared = await clerk(
    `/v1/client/sign_ins/${attempt.id}/prepare_first_factor`,
    new URLSearchParams({ strategy: "email_code", email_address_id: factor.email_address_id }),
    started.client,
  );
  if (!prepared.res.ok) fail(prepared.json, prepared.res.status, "Decision Desk HQ didn't send a code.");
  return { clientToken: prepared.client ?? started.client, signInId: attempt.id, emailAddressId: factor.email_address_id };
}

/** Finish the email-code sign-in. The code is not kept. */
export async function finishVotesCode(pending: DdhqCode, code: string): Promise<DdhqSession> {
  const tried = await clerk(
    `/v1/client/sign_ins/${pending.signInId}/attempt_first_factor`,
    new URLSearchParams({ strategy: "email_code", code }),
    pending.clientToken,
  );
  const done = signInOf(tried.json);
  if (!tried.res.ok || !done) fail(tried.json, tried.res.status, "Decision Desk HQ didn't accept that code.");
  if (done.status === "needs_second_factor") throw new AccountError("That Votes account uses a second sign-in step, which Ballotwise can't complete.", 400);
  if (done.status !== "complete" || !done.created_session_id || !tried.client) {
    throw new AccountError("Decision Desk HQ didn't finish signing in.", 502);
  }
  return { clientToken: tried.client, sessionId: done.created_session_id };
}

/** Ends the Votes session. Failures are ignored so disconnect still turns the data off. */
export async function endVotesSession(session: DdhqSession): Promise<void> {
  await clerk(`/v1/client/sessions/${session.sessionId}/end`, new URLSearchParams(), session.clientToken).catch(() => {});
}

async function clerk(path: string, body: URLSearchParams | null, client: string | null): Promise<{ res: Response; json: ClerkBody; client: string | null }> {
  const headers: Record<string, string> = { Origin: ORIGIN, Referer: `${ORIGIN}/sign-in` };
  if (body) headers["content-type"] = "application/x-www-form-urlencoded";
  if (client) headers.cookie = `__client=${client}`;
  const res = await fetch(`${CLERK}${path}?_clerk_js_version=${JS}`, { method: "POST", headers, body: body ?? "" });
  const json = (await res.json().catch(() => ({}))) as ClerkBody;
  return { res, json, client: clientToken(res) ?? client };
}

/** A short-lived session cookie for votes.decisiondeskhq.com, minted from the stored client token. */
export async function votesSessionCookie(session: DdhqSession): Promise<string> {
  const minted = await clerk(`/v1/client/sessions/${session.sessionId}/tokens`, new URLSearchParams(), session.clientToken);
  const jwt = sessionJwt(minted.json);
  if (jwt && minted.res.ok) return `__session=${jwt}`;
  if (minted.res.status === 401) {
    throw new AccountError("The Votes sign-in expired. Connect it again.", 401);
  }
  throw new AccountError("Decision Desk HQ didn't answer. Try again in a minute.", 502);
}
