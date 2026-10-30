import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CivicError, searchRaces } from "@/lib/midterms/civic";
import { UNAVAILABLE } from "@/lib/midterms/catalog";

const querySchema = z.string().trim().min(2).max(80);

/** Any US race on civicAPI by name or place ("mayor", "Greenville school board"), for races outside the tracked offices. */
export async function GET(req: NextRequest) {
  const q = querySchema.safeParse(req.nextUrl.searchParams.get("q") ?? "");
  if (!q.success) return NextResponse.json({ error: "Type at least two letters to search." }, { status: 400 });
  try {
    const races = await searchRaces(q.data, Date.now());
    return NextResponse.json({ races }, { headers: { "cache-control": "public, max-age=300" } });
  } catch (err) {
    console.error("midterms search failed:", err);
    return NextResponse.json({ error: err instanceof CivicError ? UNAVAILABLE : "Search failed. Try again." }, { status: 503 });
  }
}
