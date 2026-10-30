import { NextResponse } from "next/server";
import { liveJson } from "@/lib/midterms/etag";
import { earlyNation, EarlyVoteMissing } from "@/lib/midterms/earlyVoteSource";

/** Every reporting state's early vote counts, for the Early vote tab's map and list. */
export async function GET(req: Request) {
  try {
    return await liveJson(req, await earlyNation());
  } catch (err) {
    if (err instanceof EarlyVoteMissing) return NextResponse.json({ error: err.message }, { status: 404 });
    console.error("midterms early vote failed:", err);
    return NextResponse.json({ error: "Couldn't load the early vote. Try again in a minute." }, { status: 503 });
  }
}
