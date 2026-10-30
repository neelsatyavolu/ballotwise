import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth/session";
import { lookUpDistricts } from "@/lib/ballot/census";
import { getBallot, saveAddress, saveBallot } from "@/lib/ballot/store";
import { db, enqueue } from "@/lib/env";
import { activeGrokSession } from "@/lib/grok/session";
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

const bodySchema = z.object({ address: z.string().trim().min(8, "Enter your full street address, city, and state.").max(200) });

/**
 * Saves the voting address from the Near you screen, the same address the ballot page keeps. With Grok connected the
 * ballot's contests are found, as from the ballot page; without it only the districts are kept, which is all Near you needs.
 */
export async function PUT(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to save your address." }, { status: 401 });
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message }, { status: 400 });

  let match;
  try {
    match = await lookUpDistricts(body.data.address);
  } catch (err) {
    console.error("census lookup failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "The address lookup service didn't respond. Try again in a minute." }, { status: 502 });
  }
  if (!match) return NextResponse.json({ error: "We couldn't match that to a US address. Include the street number, city, and state." }, { status: 400 });

  // A connection that can't refresh counts as none: the address is kept, and the ballot page asks to reconnect.
  const grok = await activeGrokSession(user.id).catch(() => null);
  const now = Date.now();
  if (grok) {
    await saveBallot(db(), user.id, body.data.address, match.matchedAddress, match.districts, now);
    await enqueue([{ type: "ballot", userId: user.id }]);
  } else {
    await saveAddress(db(), user.id, body.data.address, match.matchedAddress, match.districts, now);
  }
  return NextResponse.json({ ok: true });
}
