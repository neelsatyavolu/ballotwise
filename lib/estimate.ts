import { z } from "zod";
import type { GrokTokens } from "./grok/oauth";
import { ask } from "./grok/research";
import { STANCE_MAX, STANCE_MIN, type CandidateRef, type Profile, type Race } from "./schema";

export const ESTIMATE_INSTRUCTIONS = `You help a nonpartisan voter guide fill gaps. A candidate has no sourced public position on some issues. Using only what this candidate has said and done (their other positions, record, background and endorsements, all given to you), estimate where they would most likely land on each missing issue.
- Reason the way a careful reporter would: from the candidate's own stated priorities and actions that bear on the issue. Never from party, ideology labels, or demographics alone.
- "basis" is one plain sentence naming what the estimate rests on (e.g. "Based on her support for denser housing near transit and her endorsement by a housing advocacy group."). Do not present it as their stated position.
- If nothing they have said or done bears on the issue, use null for stance and say what's missing.
Reply with one JSON object: {"estimates": [{"issueId": "...", "stance": -2..2 or null, "basis": "..."}]}`;

const estimateSchema = z.object({
  estimates: z.array(
    z.object({ issueId: z.string(), stance: z.number().int().min(STANCE_MIN).max(STANCE_MAX).nullable(), basis: z.string().trim().min(1).max(300) }),
  ),
});

/** True when some unknown stance hasn't been estimated yet. */
export function needsEstimate(profile: Profile): boolean {
  return profile.positions.some((p) => p.stance === null && p.estimate === undefined);
}

/**
 * Adds an estimate to each unknown stance, inferred from the candidate's own other positions and record.
 * Best effort: if Grok fails, the profile comes back unchanged and is tried again next time.
 */
export async function estimateMissing(tokens: GrokTokens, race: Race, candidate: CandidateRef, profile: Profile): Promise<Profile> {
  if (!needsEstimate(profile)) return profile;
  const missing = new Set(profile.positions.filter((p) => p.stance === null && p.estimate === undefined).map((p) => p.issueId));
  const issues = race.issues
    .filter((i) => missing.has(i.id))
    .map((i) => `- id "${i.id}": ${i.question}\n  -2 = strongly: ${i.sideA}\n  +2 = strongly: ${i.sideB}`)
    .join("\n");
  const known = {
    summary: profile.summary,
    positions: profile.positions.filter((p) => p.stance !== null).map(({ issueId, stance, summary, quote }) => ({ issueId, stance, summary, quote })),
    background: profile.background.map((b) => b.text),
    record: profile.record.map((r) => r.text),
    endorsements: profile.endorsements.map((e) => e.text),
  };
  const prompt = `Contest: ${race.title}, ${race.jurisdiction}.\nCandidate: ${candidate.name}.\n\nWhat we know about them:\n${JSON.stringify(known, null, 2)}\n\nIssues to estimate:\n${issues}`;

  let estimates: z.infer<typeof estimateSchema>["estimates"];
  try {
    ({ estimates } = await ask(tokens, ESTIMATE_INSTRUCTIONS, [{ role: "user", content: prompt }], estimateSchema));
  } catch (err) {
    console.error(`estimating ${candidate.name} failed:`, err instanceof Error ? err.message : err);
    return profile;
  }
  const byIssue = new Map(estimates.map((e) => [e.issueId, e]));
  return {
    ...profile,
    positions: profile.positions.map((p) => {
      if (!missing.has(p.issueId)) return p;
      const e = byIssue.get(p.issueId);
      return { ...p, estimate: e && e.stance !== null ? { stance: e.stance, basis: e.basis } : null };
    }),
  };
}
