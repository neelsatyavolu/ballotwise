// The first HTML of a tracker page carries the same answer the live API would, so the races paint with the
// document instead of after the JavaScript downloads and asks again. Client navigations skip this: that tab already
// holds the last answer and a flight payload of every race would only slow the click.
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cache } from "react";
import { headers } from "next/headers";
import type { ForecastOverview } from "@/app/api/midterms/forecast/route";
import { getCached } from "@/lib/cache";
import { db } from "@/lib/env";
import { otherRace, overview, race } from "@/lib/midterms/catalog";
import { isDocumentRequest } from "@/lib/midterms/documentRequest";
import { liveEtag } from "@/lib/midterms/etag";
import { CHAMBER_HISTORY_KEY, readOdds, type ChamberHistory } from "@/lib/midterms/odds";
import { EMPTY_SEEDS, type LiveSeed, type TrackerSeeds } from "@/components/midterms/seeds";

export type SeedKind = "tracker" | "race" | "early";

function background(work: Promise<unknown>) {
  try {
    getCloudflareContext().ctx.waitUntil(work);
  } catch (err) {
    console.error("couldn't keep a refresh running:", err);
  }
}

async function stamp(work: Promise<{ fetchedAt: number }>): Promise<LiveSeed | null> {
  try {
    const data = await work;
    return { data, etag: await liveEtag(data) };
  } catch (err) {
    console.error("live seed failed:", err);
    return null;
  }
}

async function forecastSeed(now: number): Promise<LiveSeed | null> {
  try {
    const [odds, history] = await Promise.all([readOdds(db(), now), getCached<ChamberHistory>(db(), CHAMBER_HISTORY_KEY, now)]);
    const data: ForecastOverview = { updatedAt: odds?.at ?? null, chambers: odds?.chambers && "governor" in odds.chambers ? odds.chambers : null, history };
    return { data, etag: null };
  } catch (err) {
    console.error("forecast seed failed:", err);
    return null;
  }
}

async function raceSeed(id: number, now: number): Promise<LiveSeed | null> {
  try {
    const found = (await race(db(), id, now, background)) ?? (await otherRace(id, now));
    if (!found) return null;
    return { data: found, etag: await liveEtag(found) };
  } catch (err) {
    console.error("race seed failed:", err);
    return null;
  }
}

/** `arg` is a race id, or an early-vote state postal code (empty loads the national totals only). */
export const loadSeeds = cache(async (kind: SeedKind, arg = ""): Promise<TrackerSeeds> => {
  if (!isDocumentRequest(await headers())) return EMPTY_SEEDS;
  const now = Date.now();
  if (kind === "race") {
    const id = Number(arg);
    const seeded = Number.isInteger(id) && id > 0 ? await raceSeed(id, now) : null;
    return { overview: null, forecast: null, extra: seeded ? { [`/api/midterms/race/${id}`]: seeded } : {} };
  }
  if (kind === "early") {
    const { earlyNation, earlyState, EarlyVoteMissing } = await import("@/lib/midterms/earlyVoteSource");
    const quietly = async (work: Promise<{ fetchedAt: number }>) => {
      try {
        const data = await work;
        return { data, etag: await liveEtag(data) } satisfies LiveSeed;
      } catch (err) {
        if (!(err instanceof EarlyVoteMissing)) console.error("early vote seed failed:", err);
        return null;
      }
    };
    const [nation, detail] = await Promise.all([quietly(earlyNation()), arg ? quietly(earlyState(arg)) : null]);
    const extra: Record<string, LiveSeed> = {};
    if (nation) extra["/api/midterms/early-vote"] = nation;
    if (detail) extra[`/api/midterms/early-vote/${arg}`] = detail;
    return { overview: null, forecast: null, extra };
  }
  const [overviewSeed, forecast] = await Promise.all([
    stamp(overview(db(), now, background)),
    forecastSeed(now),
  ]);
  return { overview: overviewSeed, forecast, extra: {} };
});
