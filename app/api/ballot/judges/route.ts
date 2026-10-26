import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { getBallot, setBallotStatus, setJudgesChecked } from "@/lib/ballot/store";
import { db, enqueue } from "@/lib/env";

/** Looks for the judges on a ballot found before judges were covered. Its other races and answers stay as they are. */
export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const ballot = await getBallot(db(), user.id);
  if (!ballot) return NextResponse.json({ error: "Add your address first." }, { status: 400 });
  if (ballot.status === "finding") return NextResponse.json({ ok: true });
  await setBallotStatus(db(), user.id, "finding", null, Date.now());
  await enqueue([{ type: "ballot", userId: user.id, only: "judges" }]);
  return NextResponse.json({ ok: true });
}

/** Declines the offer. "Check for new races" still finds judges later. */
export async function DELETE() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  await setJudgesChecked(db(), user.id);
  return NextResponse.json({ ok: true });
}
