import { NextResponse } from "next/server";
import { getCached } from "@/lib/cache";
import { db } from "@/lib/env";
import type { Chambers } from "@/lib/midterms/forecast";
import { CHAMBER_HISTORY_KEY, readOdds, type ChamberHistory } from "@/lib/midterms/odds";

export type ForecastOverview = {
  /** When the forecast was last computed (ms since epoch); null before the first run. */
  updatedAt: number | null;
  chambers: Chambers | null;
  history: ChamberHistory | null;
};

/** Chamber forecasts and their daily history, for the Forecast pages. */
export async function GET() {
  try {
    const now = Date.now();
    const [odds, history] = await Promise.all([readOdds(db(), now), getCached<ChamberHistory>(db(), CHAMBER_HISTORY_KEY, now)]);
    const body: ForecastOverview = { updatedAt: odds?.at ?? null, chambers: odds?.chambers && "governor" in odds.chambers ? odds.chambers : null, history };
    return NextResponse.json(body, { headers: { "cache-control": "public, max-age=60" } });
  } catch (err) {
    console.error("midterms forecast overview failed:", err);
    return NextResponse.json({ error: "Couldn't load the forecast. Try again." }, { status: 503 });
  }
}
