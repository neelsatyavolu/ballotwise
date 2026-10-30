import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/env";
import { bareRaces, CivicError, UNAVAILABLE } from "@/lib/midterms/catalog";
import { raceMarkets } from "@/lib/midterms/marketHistory";

const idSchema = z.coerce.number().int().positive();

/** One race's Polymarket and Kalshi price history, for the market panel. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success) return NextResponse.json({ error: "That race doesn't exist." }, { status: 404 });
  try {
    const now = Date.now();
    const race = (await bareRaces(now, db())).find((r) => r.id === id.data);
    if (!race || race.office === "measure") return NextResponse.json({ error: "No markets trade on that race." }, { status: 404 });
    return NextResponse.json(await raceMarkets(db(), race, now), { headers: { "cache-control": "public, max-age=60" } });
  } catch (err) {
    console.error("midterms markets failed:", err);
    return NextResponse.json({ error: err instanceof CivicError ? UNAVAILABLE : "Couldn't load the markets. Try again." }, { status: 503 });
  }
}
