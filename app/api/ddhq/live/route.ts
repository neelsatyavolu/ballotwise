import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AccountError } from "@/lib/auth/accounts";
import { currentUser } from "@/lib/auth/session";
import { deskSeats, deskView } from "@/lib/ddhq/live";
import { cachedPulse } from "@/lib/ddhq/pulse";
import { ddhqResultsSource, deleteDdhqSession, loadDdhqSession } from "@/lib/ddhq/vault";
import { ddhqSeats, loadRaceIds, rememberRaceIds, saveRaceIds } from "@/lib/ddhq/votes";
import { appEnv, db } from "@/lib/env";
import { CivicError, overview, race, UNAVAILABLE } from "@/lib/midterms/catalog";

const PRIVATE = { "cache-control": "private, no-store" };
const idSchema = z.coerce.number().int().positive().max(99_999_999);

/**
 * The overview (or `?race=<id>`, one race page) with this user's Decision Desk HQ results laid over it, the same way
 * the website lays them over in the browser. For the iOS app, which has no copy of the overlay rules. A user without a
 * connected Votes Pro account gets a 404 and keeps using the public routes.
 */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers: PRIVATE });
  const key = appEnv().GROK_TOKEN_KEY;
  if (!key) return NextResponse.json({ error: "Votes connections aren't set up on this server." }, { status: 503, headers: PRIVATE });
  const rawId = req.nextUrl.searchParams.get("race");
  const id = rawId === null ? null : idSchema.safeParse(rawId);
  if (id && !id.success) return NextResponse.json({ error: "That race doesn't exist." }, { status: 404, headers: PRIVATE });
  const saved = await loadDdhqSession(db(), key, user.id);
  if (!saved) return NextResponse.json({ error: "Connect a Votes Pro account to see Decision Desk HQ here." }, { status: 404, headers: PRIVATE });

  const background = (work: Promise<unknown>) => getCloudflareContext().ctx.waitUntil(work);
  const now = Date.now();
  let path: string;
  let data: Awaited<ReturnType<typeof overview>> | NonNullable<Awaited<ReturnType<typeof race>>>;
  try {
    if (id) {
      const found = await race(db(), id.data, now, background);
      if (!found) return NextResponse.json({ error: "That race isn't one we track." }, { status: 404, headers: PRIVATE });
      path = `/api/midterms/race/${id.data}`;
      data = found;
    } else {
      path = "/api/midterms";
      data = await overview(db(), now, background);
    }
  } catch (err) {
    console.error("ddhq live: public data failed:", err);
    return NextResponse.json({ error: err instanceof CivicError ? UNAVAILABLE : "Couldn't load results. Try again." }, { status: 503, headers: PRIVATE });
  }

  const seats = deskSeats("races" in data ? data.races : [data.race]);
  try {
    await loadRaceIds(db());
    const pulse = await cachedPulse(db(), now);
    if (pulse?.ids) rememberRaceIds(Object.entries(pulse.ids).map(([seat, raceId]) => ({ key: seat, id: String(raceId) })));
    const results = await ddhqSeats(saved.session, seats, req.signal);
    background(saveRaceIds(db()));
    const source = (await ddhqResultsSource(db(), user.id)) ?? "auto";
    return NextResponse.json({ ...deskView(path, data, results, source), desk: true, source }, { headers: PRIVATE });
  } catch (err) {
    if (err instanceof AccountError && err.status === 401) await deleteDdhqSession(db(), user.id);
    const message = err instanceof AccountError ? err.message : "Decision Desk HQ didn't answer.";
    const status = err instanceof AccountError ? err.status : 502;
    return NextResponse.json({ error: message }, { status, headers: PRIVATE });
  }
}
