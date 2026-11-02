import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/env";
import { bareRaces, CivicError, UNAVAILABLE } from "@/lib/midterms/catalog";
import { raceInsights } from "@/lib/midterms/raceInsights";

export type { RaceInsights } from "@/lib/midterms/raceInsights";

const idSchema = z.coerce.number().int().positive();

/** One race's forecast history and polls, for the race page's Forecast and Polls panels. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success) return NextResponse.json({ error: "That race doesn't exist." }, { status: 404 });
  try {
    const now = Date.now();
    const race = (await bareRaces(now, db(), (work) => getCloudflareContext().ctx.waitUntil(work))).find((r) => r.id === id.data);
    if (!race || race.office === "measure") return NextResponse.json({ error: "There's no forecast for that race." }, { status: 404 });
    return NextResponse.json(await raceInsights(db(), race, now), { headers: { "cache-control": "public, max-age=60" } });
  } catch (err) {
    console.error("midterms forecast failed:", err);
    return NextResponse.json({ error: err instanceof CivicError ? UNAVAILABLE : "Couldn't load the forecast. Try again." }, { status: 503 });
  }
}
