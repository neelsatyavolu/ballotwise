import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCached } from "@/lib/cache";
import { db } from "@/lib/env";
import { bareRaces, CivicError, UNAVAILABLE } from "@/lib/midterms/catalog";
import { HISTORY_KEY, POLLS_KEY, raceKey, type ForecastHistory } from "@/lib/midterms/odds";
import type { RacePolls } from "@/lib/midterms/pollAverage";

const idSchema = z.coerce.number().int().positive();

export type RaceInsights = {
  /** The forecast's daily chance for `side` (the side facing the Republican), one value per entry in `days`. */
  history: { days: string[]; side: "D" | "R" | "I"; p: (number | null)[] } | null;
  polls: RacePolls | null;
};

/** One race's forecast history and polls, for the race page's Forecast and Polls panels. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success) return NextResponse.json({ error: "That race doesn't exist." }, { status: 404 });
  try {
    const now = Date.now();
    const race = (await bareRaces(now, db())).find((r) => r.id === id.data);
    if (!race || race.office === "measure") return NextResponse.json({ error: "There's no forecast for that race." }, { status: 404 });
    const key = raceKey(race.office, race.state, race.district);
    const [history, polls] = await Promise.all([getCached<ForecastHistory>(db(), HISTORY_KEY, now), getCached<Record<string, RacePolls>>(db(), POLLS_KEY, now)]);
    const line = history?.races[key];
    const body: RaceInsights = { history: line && history ? { days: history.days, side: line.side, p: line.p } : null, polls: polls?.[key] ?? null };
    return NextResponse.json(body, { headers: { "cache-control": "public, max-age=60" } });
  } catch (err) {
    console.error("midterms forecast failed:", err);
    return NextResponse.json({ error: err instanceof CivicError ? UNAVAILABLE : "Couldn't load the forecast. Try again." }, { status: 503 });
  }
}
