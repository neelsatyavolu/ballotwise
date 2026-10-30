import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { getBallot } from "@/lib/ballot/store";
import { db } from "@/lib/env";
import { CivicError, UNAVAILABLE } from "@/lib/midterms/catalog";
import { liveJson } from "@/lib/midterms/etag";
import { localRaces } from "@/lib/midterms/local";

/** One voter's answer: kept in their browser only, never in a shared cache. */
const PRIVATE = "private, max-age=15";

/** The races near the signed-in voter's saved address, with live numbers. `local` is null until they save one. */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to see the races near you." }, { status: 401 });
  const now = Date.now();
  const ballot = await getBallot(db(), user.id);
  if (!ballot) return liveJson(req, { fetchedAt: now, local: null }, PRIVATE);
  try {
    const { fetchedAt, stale, ...local } = await localRaces(ballot.districts, now);
    return await liveJson(req, { fetchedAt, stale, local }, PRIVATE);
  } catch (err) {
    console.error("midterms local races failed:", err);
    return NextResponse.json({ error: err instanceof CivicError ? UNAVAILABLE : "Couldn't load the races near you. Try again." }, { status: 503 });
  }
}
