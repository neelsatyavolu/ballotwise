// Conditional responses for the live JSON routes, so a poll whose answer hasn't changed costs a bodiless 304.
import { NextResponse } from "next/server";

const CACHE = "public, max-age=15";

/** Whether an If-None-Match header names `etag`, weak or strong (Cloudflare weakens ETags when it compresses). */
export function matches(header: string | null, etag: string): boolean {
  if (!header) return false;
  const bare = (tag: string) => tag.trim().replace(/^W\//, "");
  return header.split(",").some((tag) => tag.trim() === "*" || bare(tag) === bare(etag));
}

async function digest(text: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text)));
  return Array.from(hash.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * `payload` as JSON with a weak ETag over everything but `fetchedAt`, which moves on every refresh even when no
 * number did; or a 304 when the request already holds that ETag. Both carry the fetch time as `x-fetched-at`, so a
 * page keeping its copy still knows how fresh it is. `cache` replaces the shared-cache header for an answer meant for one
 * signed-in user.
 */
export async function liveJson(req: Request, payload: { fetchedAt: number } & Record<string, unknown>, cache = CACHE): Promise<Response> {
  const { fetchedAt, ...content } = payload;
  const body = JSON.stringify(content);
  const etag = `W/"${await digest(body)}"`;
  const headers = { "cache-control": cache, etag, "x-fetched-at": String(fetchedAt) };
  if (matches(req.headers.get("if-none-match"), etag)) return new NextResponse(null, { status: 304, headers });
  // fetchedAt goes back in front; the rest is the string already hashed.
  const json = body === "{}" ? `{"fetchedAt":${fetchedAt}}` : `{"fetchedAt":${fetchedAt},${body.slice(1)}`;
  return new NextResponse(json, { headers: { ...headers, "content-type": "application/json" } });
}
