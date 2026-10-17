import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { getBallot, setBallotStatus } from "@/lib/ballot/store";
import { db, enqueue } from "@/lib/env";

/** Looks for contests again, for example once more candidates have filed. Existing guides and answers stay. */
export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const ballot = await getBallot(db(), user.id);
  if (!ballot) return NextResponse.json({ error: "Add your address first." }, { status: 400 });
  if (ballot.status === "finding") return NextResponse.json({ ok: true });
  await setBallotStatus(db(), user.id, "finding", null, Date.now());
  await enqueue([{ type: "ballot", userId: user.id }]);
  return NextResponse.json({ ok: true });
}
