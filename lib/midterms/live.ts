// Rules for the tracker's polling client, kept free of React so they can be tested on their own.
import { electionModeDefault } from "./polls";

/** How often an open tracker page asks for new results. */
export const POLL_MS = 30_000;
/** From election day on, results move fast and the server's copy is refreshed every 30 seconds, so pages ask twice as often. */
export const ELECTION_POLL_MS = 15_000;
/** A poll still unanswered after this long is given up, so one hung request can't stop the page updating. */
export const LIVE_TIMEOUT_MS = 20_000;
/** After failed polls, the wait doubles each time up to this. */
export const MAX_BACKOFF_MS = 2 * 60_000;
/** Results older than this (by the server's fetch time) are worth flagging on screen as possibly behind. */
export const LAG_MS = 45_000;

/** How long to wait between polls at `now` (the tracker's clock), so a page left open into Nov 3 speeds up on its own. */
export const pollInterval = (now: number) => (electionModeDefault(now) ? ELECTION_POLL_MS : POLL_MS);

/** The wait before the next poll after `failures` failed ones in a row: the interval, doubling per failure, capped. */
export const retryDelay = (interval: number, failures: number) => Math.min(interval * 2 ** failures, MAX_BACKOFF_MS);

/** Whether results fetched at `fetchedAt` are LAG_MS or more behind `now`. False when there's no fetch time. */
export const isLagging = (fetchedAt: number | null, now: number) => fetchedAt !== null && now - fetchedAt > LAG_MS;

export const fetchedAtOf = (data: unknown): number | null => {
  const at = (data as { fetchedAt?: unknown } | null)?.fetchedAt;
  return typeof at === "number" ? at : null;
};

/**
 * Whether `next` should replace `held`. Polls land on different server instances whose copies of the results can
 * differ in age, so an answer older than the one on screen is dropped rather than letting counts go backwards, and
 * one from the same fetch is kept as it is, so the page doesn't redraw for nothing. `changed` says the server
 * found the content different (a new ETag): then an answer from the same fetch time still replaces the held one,
 * since calls and ratings can move without a new civicAPI fetch.
 */
export function isNewer(held: unknown, next: unknown, changed = false): boolean {
  const a = fetchedAtOf(held);
  const b = fetchedAtOf(next);
  return a === null || b === null || b > a || (b === a && changed);
}

/** A poll's answer: unchanged since the ETag sent (`data` absent), or new data. `fetchedAt` is the server's fetch time. */
export type LiveAnswer<T> = { etag: string | null; fetchedAt: number | null } & ({ same: true } | { same: false; data: T });

export class LiveError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * One poll of `path`, sending the held ETag so an unchanged answer comes back as a bodiless 304. Throws LiveError
 * with the server's readable message, or a plain one when offline or `signal` aborted it.
 */
export async function fetchLive<T>(path: string, etag: string | null, signal: AbortSignal): Promise<LiveAnswer<T>> {
  let res: Response;
  try {
    res = await fetch(path, { headers: etag ? { "if-none-match": etag } : undefined, signal });
  } catch {
    throw new LiveError(signal.aborted ? "Results are taking too long to load." : "You appear to be offline. Check your connection and try again.", 0);
  }
  const header = Number(res.headers.get("x-fetched-at"));
  const stamped = Number.isFinite(header) && header > 0 ? header : null;
  if (res.status === 304) return { same: true, etag: res.headers.get("etag") ?? etag, fetchedAt: stamped };
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new LiveError(json.error ?? `Request failed (${res.status}).`, res.status);
  const fresh = res.headers.get("etag");
  // A browser cache that revalidated on its own hands back a 200 with the same ETag.
  if (fresh && fresh === etag) return { same: true, etag, fetchedAt: stamped ?? fetchedAtOf(json) };
  return { same: false, data: json as T, etag: fresh, fetchedAt: stamped ?? fetchedAtOf(json) };
}
