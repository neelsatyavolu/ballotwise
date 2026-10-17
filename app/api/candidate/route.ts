import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { research } from "@/lib/grok/research";
import { currentUser } from "@/lib/auth/session";
import { getCached, profileKey, putCached } from "@/lib/cache";
import { db } from "@/lib/env";
import { estimateMissing } from "@/lib/estimate";
import { activeGrokSession } from "@/lib/grok/session";
import { alignPositions, keepRetrievedSources } from "@/lib/profile";
import { PROFILE_INSTRUCTIONS, profilePrompt } from "@/lib/prompts";
import { profileSchema, raceSchema, type Profile } from "@/lib/schema";
import { ndjsonResponse } from "@/lib/stream";

export const maxDuration = 300;

// The race comes back from the browser, so its sources may have been filtered to empty; only shape matters here.
const bodySchema = z.object({ race: raceSchema.extend({ sources: z.array(z.string()).max(12) }), candidateId: z.string() });

export async function POST(req: NextRequest) {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "That request was malformed. Search for the race again." }, { status: 400 });
  const { race, candidateId } = body.data;
  const candidate = race.candidates.find((c) => c.id === candidateId);
  if (!candidate) return NextResponse.json({ error: "That candidate isn't in this race." }, { status: 400 });

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to research candidates." }, { status: 401 });

  let tokens;
  try {
    tokens = await activeGrokSession(user.id);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Grok session error." }, { status: 401 });
  }
  if (!tokens) return NextResponse.json({ error: "Connect your Grok account to research candidates." }, { status: 401 });

  return ndjsonResponse<Profile>(async (progress) => {
    const key = profileKey(race, candidate);
    const cached = await getCached<Profile>(db(), key, Date.now());
    let found = cached;
    if (!found) {
      const { data, retrieved } = await research(tokens, PROFILE_INSTRUCTIONS, profilePrompt(race, candidate), profileSchema, progress);
      found = alignPositions(keepRetrievedSources(data, retrieved), race.issues);
    }
    const profile = await estimateMissing(tokens, race, candidate, found);
    if (profile !== cached) await putCached(db(), key, profile, Date.now());
    return profile;
  });
}
