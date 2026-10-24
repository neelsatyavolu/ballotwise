import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth/session";
import { db } from "@/lib/env";
import { trackedIds, UNAVAILABLE } from "@/lib/midterms/catalog";
import { addFavorites, listFavorites, MAX_FAVORITES, removeFavorite } from "@/lib/midterms/favorites";

const SIGN_IN = "Sign in to star races.";
const raceId = z.number().int().positive();

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: SIGN_IN }, { status: 401 });
  return NextResponse.json({ raceIds: await listFavorites(db(), user.id) });
}

const addSchema = z.object({ raceIds: z.array(raceId).min(1).max(MAX_FAVORITES) });

/** Stars one or more races. */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: SIGN_IN }, { status: 401 });
  const body = addSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Pick a race to star." }, { status: 400 });

  let known: Set<number>;
  try {
    known = await trackedIds(Date.now(), db());
  } catch {
    return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
  }
  const d = db();
  const current = await listFavorites(d, user.id);
  const fresh = body.data.raceIds.filter((id) => known.has(id) && !current.includes(id));
  if (current.length + fresh.length > MAX_FAVORITES) return NextResponse.json({ error: `You can star up to ${MAX_FAVORITES} races.` }, { status: 400 });
  await addFavorites(d, user.id, fresh, Date.now());
  return NextResponse.json({ raceIds: await listFavorites(d, user.id) });
}

const removeSchema = z.object({ raceId });

export async function DELETE(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: SIGN_IN }, { status: 401 });
  const body = removeSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Pick a race to unstar." }, { status: 400 });
  await removeFavorite(db(), user.id, body.data.raceId);
  return NextResponse.json({ raceIds: await listFavorites(db(), user.id) });
}
