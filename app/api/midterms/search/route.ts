import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CivicError, searchRaces } from "@/lib/midterms/civic";
import { mergeFound, searchCounty } from "@/lib/midterms/county";
import { UNAVAILABLE } from "@/lib/midterms/catalog";

const querySchema = z.string().trim().min(2).max(80);

/**
 * Any US race on civicAPI by name or place ("mayor", "Greenville school board"), for races outside the tracked offices,
 * plus Santa Clara County's local races from the county's own results. Either source failing leaves the other's results.
 */
export async function GET(req: NextRequest) {
  const q = querySchema.safeParse(req.nextUrl.searchParams.get("q") ?? "");
  if (!q.success) return NextResponse.json({ error: "Type at least two letters to search." }, { status: 400 });
  const now = Date.now();
  const [civic, county] = await Promise.allSettled([searchRaces(q.data, now), searchCounty(q.data, now)]);
  if (county.status === "rejected") console.error("county search failed:", county.reason);
  if (civic.status === "rejected") {
    console.error("midterms search failed:", civic.reason);
    // With county matches in hand, those still answer the search; otherwise the failure is the answer.
    if (county.status !== "fulfilled" || !county.value.length) {
      return NextResponse.json({ error: civic.reason instanceof CivicError ? UNAVAILABLE : "Search failed. Try again." }, { status: 503 });
    }
  }
  const races = mergeFound(q.data, county.status === "fulfilled" ? county.value : [], civic.status === "fulfilled" ? civic.value : []);
  // An answer missing one source isn't cached, so the next search can pick it back up.
  const whole = civic.status === "fulfilled" && county.status === "fulfilled";
  return NextResponse.json({ races }, { headers: { "cache-control": whole ? "public, max-age=300" : "no-store" } });
}
