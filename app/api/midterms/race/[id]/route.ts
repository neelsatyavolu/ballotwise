import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/env";
import { CivicError, otherRace, race, UNAVAILABLE } from "@/lib/midterms/catalog";
import { liveJson } from "@/lib/midterms/etag";

// civicAPI race ids are positive integers well under this; anything else is rejected before reaching civicAPI.
const idSchema = z.coerce.number().int().positive().max(99_999_999);

export async function GET(req: NextRequest, ctx: RouteContext<"/api/midterms/race/[id]">) {
  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success) return NextResponse.json({ error: "That race doesn't exist." }, { status: 404 });
  try {
    const now = Date.now();
    // A tracked race comes with its ratings and calls; any other US race on civicAPI (found by search) comes bare.
    const found = (await race(db(), id.data, now, (work) => getCloudflareContext().ctx.waitUntil(work))) ?? (await otherRace(id.data, now));
    if (!found) return NextResponse.json({ error: "civicAPI has no US race with that id." }, { status: 404 });
    return await liveJson(req, found);
  } catch (err) {
    console.error("midterms race failed:", err);
    return NextResponse.json({ error: err instanceof CivicError ? UNAVAILABLE : "Couldn't load this race. Try again." }, { status: 503 });
  }
}
