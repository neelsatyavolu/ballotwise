import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/env";
import { CivicError, race, UNAVAILABLE } from "@/lib/midterms/catalog";

const idSchema = z.coerce.number().int().positive();

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/midterms/race/[id]">) {
  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success) return NextResponse.json({ error: "That race doesn't exist." }, { status: 404 });
  try {
    const found = await race(db(), id.data, Date.now());
    if (!found) return NextResponse.json({ error: "That race isn't one the tracker follows." }, { status: 404 });
    return NextResponse.json(found, { headers: { "cache-control": "public, max-age=15" } });
  } catch (err) {
    console.error("midterms race failed:", err);
    return NextResponse.json({ error: err instanceof CivicError ? UNAVAILABLE : "Couldn't load this race. Try again." }, { status: 503 });
  }
}
