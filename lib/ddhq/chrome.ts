import { appEnv } from "../env";

const VOTES = "https://votes.decisiondeskhq.com";

/** The private container supplies Chrome TLS; Workers cannot spawn curl-cffi. */
export async function chromeVotes(path: string, cookie: string): Promise<Response | null> {
  const page = /^\/forecast\/2026\/(?:house|senate|governor)$/.test(path);
  if (!page && !/^\/api\/(?:searchv2|vote-history|(?:forecast|races)\/\d+)(?:\?[^#\s\\]*)?$/.test(path)) return null;
  if (!/^__session=[A-Za-z0-9._-]+$/.test(cookie)) return null;
  try {
    const egress = appEnv().DDHQ_EGRESS;
    if (!egress) return null;
    const response = await egress.fetch(new Request(`${VOTES}${path}`, {
      headers: { cookie, accept: page ? "text/x-component" : "application/json" },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    }));
    // Never follow a redirect with this user's cookie or accept an HTML success page.
    if (response.status >= 300 && response.status < 400) return null;
    if (response.ok && !response.headers.get("content-type")?.toLowerCase().startsWith(page ? "text/x-component" : "application/json")) return null;
    return response;
  } catch {
    // Missing bindings, cold-start failures and transport outages must not disconnect the account.
    return null;
  }
}
