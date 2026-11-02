// Decision Desk HQ's early vote by party, from the public feed behind its race pages' Early Voting tab (no login).
// Used where civicAPI has no party for a state's ballots: DDHQ gives every state a party count, assigning one from
// its voter data where the state doesn't register voters by party.
import { z } from "zod";
import { appEnv } from "../env";
import type { PartySplit } from "./earlyVote";

const FEED = "https://votes.decisiondeskhq.com/api/abev/election";
/**
 * DDHQ's site sits behind Vercel's bot check, which turns away requests that don't look like a browser. In production
 * they go through the Chrome-TLS egress container (services/ddhq-egress) with no session; these headers are for a
 * direct fetch where that binding is missing (local dev).
 */
const HEADERS = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  referer: "https://votes.decisiondeskhq.com/",
};

const feed = z.array(
  z.object({
    countyfips: z.coerce.string(),
    parties: z.array(z.object({ name: z.string(), returns: z.number().nonnegative().default(0), early: z.number().nonnegative().default(0) })),
  }),
);

/** A state's ballots cast (mail returned plus in-person early) by party, statewide and by county FIPS code. */
export type DdhqEarly = { state: PartySplit; counties: Record<string, PartySplit> };

const add = (a: PartySplit, b: PartySplit): PartySplit => ({ dem: a.dem + b.dem, rep: a.rep + b.rep, other: a.other + b.other });
const ZERO: PartySplit = { dem: 0, rep: 0, other: 0 };

/**
 * Reads one state's feed. County codes are the three-digit part of a county's FIPS code; longer codes are New England
 * towns and "0" a statewide line, which count toward the state but aren't counties. Null when nothing has been cast.
 */
export function readDdhqEarly(stateFips: string, body: unknown): DdhqEarly | null {
  const rows = feed.parse(body);
  let state = ZERO;
  const counties: Record<string, PartySplit> = {};
  for (const row of rows) {
    const split = row.parties.reduce<PartySplit>((t, p) => {
      const cast = p.returns + p.early;
      if (p.name === "Democrat") return { ...t, dem: t.dem + cast };
      if (p.name === "Republican") return { ...t, rep: t.rep + cast };
      return { ...t, other: t.other + cast };
    }, ZERO);
    state = add(state, split);
    if (/^\d{1,3}$/.test(row.countyfips) && Number(row.countyfips) > 0) {
      const fips = stateFips + row.countyfips.padStart(3, "0");
      counties[fips] = add(counties[fips] ?? ZERO, split);
    }
  }
  const cast = (p: PartySplit) => p.dem + p.rep + p.other > 0;
  return cast(state) ? { state, counties: Object.fromEntries(Object.entries(counties).filter(([, p]) => cast(p))) } : null;
}

/** One state's DDHQ party counts, or null when DDHQ has none or can't be reached (the page then goes without). */
export async function ddhqEarly(state: string, stateFips: string, deadline: number): Promise<DdhqEarly | null> {
  const params = new URLSearchParams({ state, election_date: "2026-11-03", is_primary: "false", is_ballot_prop: "false" });
  const url = `${FEED}?${params}`;
  const signal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
  try {
    const egress = appEnv().DDHQ_EGRESS;
    const res = egress
      ? await egress.fetch(new Request(url, { redirect: "manual", signal }))
      : await fetch(url, { headers: HEADERS, redirect: "manual", signal });
    if (!res.ok || !res.headers.get("content-type")?.startsWith("application/json")) {
      console.error(`DDHQ early vote for ${state}: HTTP ${res.status}${res.headers.get("x-vercel-mitigated") ? " (bot check)" : ""}`);
      return null;
    }
    return readDdhqEarly(stateFips, await res.json());
  } catch (err) {
    console.error(`DDHQ early vote for ${state} failed:`, err);
    return null;
  }
}
