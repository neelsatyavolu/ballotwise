import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { db } from "@/lib/env";
import { trackedPicks } from "@/lib/guides";
import { ELECTION_DATE } from "@/lib/midterms/races";

/** The signed-in voter's best matches from their guides for election day, so the tracker can mark them. Private to them. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to see your picks." }, { status: 401 });
  try {
    const picks = await trackedPicks(db(), user.id, ELECTION_DATE);
    return NextResponse.json({ picks }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("midterms picks failed:", err);
    return NextResponse.json({ error: "Couldn't load your picks." }, { status: 500 });
  }
}
