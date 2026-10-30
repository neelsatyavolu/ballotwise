import { NextRequest, NextResponse } from "next/server";
import { isState } from "@/lib/midterms/earlyVote";
import { liveJson } from "@/lib/midterms/etag";
import { earlyState, EarlyVoteMissing } from "@/lib/midterms/earlyVoteSource";

/** One state's early vote: totals, counties, demographics and the same day in 2024. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/midterms/early-vote/[state]">) {
  const state = (await ctx.params).state.toUpperCase();
  if (!isState(state)) return NextResponse.json({ error: "That isn't a state." }, { status: 404 });
  try {
    return await liveJson(req, await earlyState(state));
  } catch (err) {
    if (err instanceof EarlyVoteMissing) return NextResponse.json({ error: err.message }, { status: 404 });
    console.error(`midterms early vote for ${state} failed:`, err);
    return NextResponse.json({ error: "Couldn't load this state's early vote. Try again in a minute." }, { status: 503 });
  }
}
