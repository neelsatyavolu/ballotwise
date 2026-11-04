import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CivicError, searchRaces } from "@/lib/midterms/civic";
import { mergeFound, searchCounty } from "@/lib/midterms/county";
import { UNAVAILABLE } from "@/lib/midterms/catalog";
import { searchDdhq, withDdhq } from "@/lib/ddhq/search";

const querySchema = z.string().trim().min(2).max(80);
/** With DDHQ's matches in hand, civicAPI gets this long to add its own before the answer goes out. */
const CIVIC_GRACE_MS = 1_500;

/** A promise's outcome, or null once `ms` passes first; with no `ms`, however long it takes. */
function within<T>(work: Promise<T>, ms?: number): Promise<PromiseSettledResult<T> | null> {
  const settled = work.then((value) => ({ status: "fulfilled" as const, value }), (reason: unknown) => ({ status: "rejected" as const, reason }));
  return ms === undefined ? settled : Promise.race([settled, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

/**
 * Any US race by name or place ("mayor", "Greenville school board"), for races outside the tracked offices: Decision
 * Desk HQ's page for a county or state the query names, Santa Clara County's own results, and civicAPI's search.
 * DDHQ answers in well under a second, so when it has matches, civicAPI isn't waited on past
 * CIVIC_GRACE_MS; its search keeps running so the next search finds it cached. Any source failing leaves the others'.
 */
export async function GET(req: NextRequest) {
  const q = querySchema.safeParse(req.nextUrl.searchParams.get("q") ?? "");
  if (!q.success) return NextResponse.json({ error: "Type at least two letters to search." }, { status: 400 });
  const now = Date.now();
  const civicWork = searchRaces(q.data, now);
  const [ddhq, county] = await Promise.allSettled([searchDdhq(q.data, now), searchCounty(q.data, now)]);
  if (ddhq.status === "rejected") console.error("DDHQ search failed:", ddhq.reason);
  if (county.status === "rejected") console.error("county search failed:", county.reason);
  const ddhqFound = ddhq.status === "fulfilled" ? ddhq.value : [];
  const countyFound = county.status === "fulfilled" ? county.value : [];
  // DDHQ only answers a query naming a place, so its matches mean that place is covered; the county feed also matches
  // office-only queries ("school board"), which still wait for civicAPI's nationwide results.
  const fast = ddhqFound.length > 0;
  const civic = await within(civicWork, fast ? CIVIC_GRACE_MS : undefined);
  if (!civic) {
    try {
      getCloudflareContext().ctx.waitUntil(civicWork.catch(() => undefined));
    } catch {
      // Outside Workers the search simply runs on.
    }
  } else if (civic.status === "rejected") {
    console.error("midterms search failed:", civic.reason);
    // With other matches in hand, those still answer the search; otherwise the failure is the answer.
    if (!fast && !countyFound.length) return NextResponse.json({ error: civic.reason instanceof CivicError ? UNAVAILABLE : "Search failed. Try again." }, { status: 503 });
  }
  const races = withDdhq(ddhqFound, mergeFound(q.data, countyFound, civic?.status === "fulfilled" ? civic.value : []));
  // An answer missing a source isn't cached, so the next search can pick it back up.
  const whole = civic?.status === "fulfilled" && county.status === "fulfilled" && ddhq.status === "fulfilled";
  return NextResponse.json({ races }, { headers: { "cache-control": whole ? "public, max-age=300" : "no-store" } });
}
