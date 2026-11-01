import { NextResponse } from "next/server";
import { db } from "@/lib/env";
import { listCallEvents } from "@/lib/midterms/calls";
import { bareRaces } from "@/lib/midterms/catalog";
import { callAlert, type CallAlert } from "@/lib/midterms/callAlert";

export type { CallAlert };

/** How many of the newest calls each answer carries: more than can land between two polls. */
const LATEST = 20;

/**
 * The newest race calls, changed calls and withdrawals, each with the words the phone alerts use, for the pop-up
 * every tracker page shows when a race is called. Small, so a page can ask every few seconds, even in a hidden tab.
 */
export async function GET() {
  try {
    const now = Date.now();
    const [events, races] = await Promise.all([listCallEvents(db(), { limit: LATEST }), bareRaces(now, db())]);
    const byId = new Map(races.map((r) => [r.id, r]));
    return NextResponse.json({ alerts: events.map((e) => callAlert(e, byId.get(e.raceId))) }, { headers: { "cache-control": "public, max-age=10" } });
  } catch (err) {
    console.error("midterm latest calls failed:", err);
    return NextResponse.json({ error: "Couldn't load race calls. Try again." }, { status: 503 });
  }
}
