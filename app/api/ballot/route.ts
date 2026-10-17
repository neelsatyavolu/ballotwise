import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth/session";
import { lookUpDistricts } from "@/lib/ballot/census";
import { getBallot, saveBallot } from "@/lib/ballot/store";
import { db, enqueue } from "@/lib/env";
import { activeGrokSession } from "@/lib/grok/session";
import { claimEstimates, listGuides } from "@/lib/guides";
import { claimRealignment } from "@/lib/values";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to see your ballot." }, { status: 401 });
  const [ballot, guides] = await Promise.all([getBallot(db(), user.id), listGuides(db(), user.id, "ballot")]);
  // Guides researched before stance estimates existed get them filled in the background.
  await enqueue((await claimEstimates(db(), user.id, Date.now())).map((guideId) => ({ type: "estimate" as const, guideId })));
  // Likewise, interview mappings that left issues blank are redone with inferred answers.
  await enqueue((await claimRealignment(db(), user.id, Date.now())).map((guideId) => ({ type: "align" as const, guideId })));
  return NextResponse.json({ ballot, guides });
}

const bodySchema = z.object({ address: z.string().trim().min(8, "Enter your full street address, city, and state.").max(200) });

/** Saves the voting address, matches it to districts, and starts finding contests in the background. */
export async function PUT(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to set your address." }, { status: 401 });
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message }, { status: 400 });

  try {
    if (!(await activeGrokSession(user.id))) return NextResponse.json({ error: "Connect Grok first, so your ballot can be researched." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Grok session error." }, { status: 400 });
  }

  let match;
  try {
    match = await lookUpDistricts(body.data.address);
  } catch (err) {
    console.error("census lookup failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "The address lookup service didn't respond. Try again in a minute." }, { status: 502 });
  }
  if (!match) {
    return NextResponse.json({ error: "We couldn't match that to a US address. Include the street number, city, and state." }, { status: 400 });
  }

  await saveBallot(db(), user.id, body.data.address, match.matchedAddress, match.districts, Date.now());
  await enqueue([{ type: "ballot", userId: user.id }]);
  return NextResponse.json({ ballot: await getBallot(db(), user.id) });
}
