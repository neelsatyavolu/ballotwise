import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { db } from "@/lib/env";
import { listCallEvents } from "@/lib/midterms/calls";
import { bareRaces } from "@/lib/midterms/catalog";
import { callAlert, popsUp, type CallAlert } from "@/lib/midterms/callAlert";
import { raceKey, readOdds } from "@/lib/midterms/odds";

export type { CallAlert };

/** How many of the newest calls each answer carries: more than can land between two polls. */
const LATEST = 20;
/** How many of the newest events are read to find them: a poll-closing wave can call well over 100 safe seats at once. */
const SCAN = 400;

/**
 * The newest race calls, changed calls and withdrawals in competitive Senate and House races (see popsUp), each with
 * the words the phone alerts use, for the pop-up every tracker page shows when one is called. Small, so a page can ask every few seconds, even in a hidden tab.
 */
export async function GET() {
  try {
    const now = Date.now();
    const [events, races, odds] = await Promise.all([listCallEvents(db(), { limit: SCAN }), bareRaces(now, db(), (work) => getCloudflareContext().ctx.waitUntil(work)), readOdds(db(), now)]);
    const byId = new Map(races.map((r) => [r.id, r]));
    const shown = events.filter((e) => {
      const race = byId.get(e.raceId);
      return !!race && popsUp(e.office, odds?.signals[raceKey(race.office, race.state, race.district)]?.rating);
    });
    return NextResponse.json({ alerts: shown.slice(0, LATEST).map((e) => callAlert(e, byId.get(e.raceId))) }, { headers: { "cache-control": "public, max-age=10" } });
  } catch (err) {
    console.error("midterm latest calls failed:", err);
    return NextResponse.json({ error: "Couldn't load race calls. Try again." }, { status: 503 });
  }
}
