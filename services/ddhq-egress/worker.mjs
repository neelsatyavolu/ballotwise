import { Container, getContainer } from "@cloudflare/containers";

const PRIVATE = { "cache-control": "private, no-store" };
const SEARCH_KEYS = new Set(["q", "filterYear", "filterState", "filterOffice"]);

function validPath(url) {
  const keys = [...url.searchParams.keys()];
  if (url.hash || url.pathname.includes("%") || url.href.length > 2048 || new Set(keys).size !== keys.length) return false;
  if (/^\/forecast\/2026\/(house|senate|governor)$/.test(url.pathname)) return keys.length === 0;
  if (/^\/api\/(forecast|races)\/[0-9]+$/.test(url.pathname)) return keys.length === 0;
  if (url.pathname === "/api/vote-history") return keys.length === 1 && keys[0] === "race_id" && /^[0-9]+$/.test(url.searchParams.get("race_id"));
  return url.pathname === "/api/searchv2" && keys.length === 4 && keys.every((key) => SEARCH_KEYS.has(key) && url.searchParams.get(key));
}

export class VotesContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "2m";
  enableInternet = true;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cookie = request.headers.get("cookie") ?? "";
    if (request.method !== "GET" || !validPath(url) || cookie.length > 8192 || !/^__session=[A-Za-z0-9._-]+$/.test(cookie)) {
      return Response.json({ error: "Invalid Votes request" }, { status: 400, headers: PRIVATE });
    }
    try {
      const upstream = await getContainer(env.VOTES, "votes").fetch(new Request(`http://container${url.pathname}${url.search}`, {
        headers: { cookie },
        redirect: "manual",
        signal: request.signal,
      }));
      const headers = new Headers(PRIVATE);
      for (const key of ["content-type", "x-vercel-mitigated", "retry-after"]) {
        const value = upstream.headers.get(key);
        if (value) headers.set(key, value);
      }
      const authStatus = upstream.headers.get("x-clerk-auth-status");
      if (["signed-in", "signed-out", "handshake"].includes(authStatus)) headers.set("x-clerk-auth-status", authStatus);
      return new Response(upstream.body, { status: upstream.status, headers });
    } catch {
      return Response.json({ error: "Votes transport unavailable" }, { status: 502, headers: PRIVATE });
    }
  },
};
