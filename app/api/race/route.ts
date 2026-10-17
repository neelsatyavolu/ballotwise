import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { research, ResearchError } from "@/lib/grok/research";
import { currentUser } from "@/lib/auth/session";
import { activeGrokSession } from "@/lib/grok/session";
import { balanceSides, keepRetrievedRaceSources } from "@/lib/profile";
import { RACE_INSTRUCTIONS, racePrompt } from "@/lib/prompts";
import { raceResultSchema, type RaceResult } from "@/lib/schema";
import { ndjsonResponse } from "@/lib/stream";

export const maxDuration = 300;

const bodySchema = z.object({ query: z.string().trim().min(3).max(200) });

export async function POST(req: NextRequest) {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Enter an election or race, like “Los Angeles mayor 2026”." }, { status: 400 });

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to look up elections." }, { status: 401 });

  let tokens;
  try {
    tokens = await activeGrokSession(user.id);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Grok session error." }, { status: 401 });
  }
  if (!tokens) return NextResponse.json({ error: "Connect your Grok account to look up elections." }, { status: 401 });

  return ndjsonResponse<RaceResult>(async (progress) => {
    const { data, retrieved } = await research(tokens, RACE_INSTRUCTIONS, racePrompt(body.data.query), raceResultSchema, progress);
    if (data.kind !== "race") return data;
    const race = balanceSides(keepRetrievedRaceSources(data.race, retrieved));
    if (race.sources.length === 0) throw new ResearchError("Grok couldn't confirm the candidate list from a source. Try a more specific search.", 502);
    return { kind: "race", race };
  });
}
