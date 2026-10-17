import { z } from "zod";
import type { Db } from "../auth/accounts";
import { refreshGrokTokens, type GrokTokens } from "../grok/oauth";
import { research, ResearchError } from "../grok/research";
import { usableGrokTokens } from "../grok/vault";
import { guideForJob, saveCandidateResult, saveRaceForGuide, setGuideStatus } from "../guides";
import { alignPositions, balanceSides, keepRetrievedRaceSources, keepRetrievedSources } from "../profile";
import { BALLOT_INSTRUCTIONS, ballotPrompt, PROFILE_INSTRUCTIONS, profilePrompt, RACE_INSTRUCTIONS, racePrompt } from "../prompts";
import { ballotContestsSchema, profileSchema, raceResultSchema, type Race } from "../schema";
import { addContestGuides, getBallot, setBallotStatus } from "./store";

export const jobSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ballot"), userId: z.string() }),
  z.object({ type: z.literal("race"), guideId: z.string() }),
  z.object({ type: z.literal("candidate"), guideId: z.string(), candidateId: z.string() }),
]);
export type Job = z.infer<typeof jobSchema>;

export type JobDeps = { db: Db; tokenKey: string; enqueue: (jobs: Job[]) => Promise<void>; now?: () => number };

/** A failure that won't fix itself on retry, such as a missing Grok connection. */
export class PermanentJobError extends Error {}

const ignoreProgress = (): void => {};

async function tokensFor(deps: JobDeps, userId: string) {
  const tokens = await usableGrokTokens(deps.db, deps.tokenKey, userId, refreshGrokTokens);
  if (!tokens) throw new PermanentJobError("Grok isn't connected. Connect Grok, then refresh your ballot.");
  return tokens;
}

function permanent(err: unknown): never {
  // A rejected session won't recover by retrying; rate limits and timeouts might.
  if (err instanceof ResearchError && err.status === 401) throw new PermanentJobError(err.message);
  throw err;
}

export async function runJob(job: Job, deps: JobDeps): Promise<void> {
  const now = deps.now ?? Date.now;
  if (job.type === "ballot") {
    const ballot = await getBallot(deps.db, job.userId);
    if (!ballot) return;
    const tokens = await tokensFor(deps, job.userId);
    const { data } = await research(tokens, BALLOT_INSTRUCTIONS, ballotPrompt(ballot.matchedAddress, ballot.districts), ballotContestsSchema, ignoreProgress).catch(permanent);
    const added = await addContestGuides(deps.db, job.userId, data, now());
    await deps.enqueue(added.map((guideId) => ({ type: "race", guideId })));
    await setBallotStatus(deps.db, job.userId, "ready", null, now());
    return;
  }

  const guide = await guideForJob(deps.db, job.guideId);
  if (!guide) return; // Deleted while queued.
  const tokens = await tokensFor(deps, guide.userId);

  if (job.type === "race") {
    await setGuideStatus(deps.db, job.guideId, "researching", null, now());
    let result = (await research(tokens, RACE_INSTRUCTIONS, racePrompt(guide.query), raceResultSchema, ignoreProgress).catch(permanent));
    // The query names one contest, so an ambiguous answer gets one more try with Grok's most specific option.
    if (result.data.kind === "choose") {
      result = await research(tokens, RACE_INSTRUCTIONS, racePrompt(result.data.options[0].query), raceResultSchema, ignoreProgress).catch(permanent);
    }
    if (result.data.kind !== "race") {
      const reason = result.data.kind === "none" ? result.data.reason : "Grok couldn't pin down this contest.";
      throw new PermanentJobError(reason);
    }
    const race = balanceSides(keepRetrievedRaceSources(result.data.race, result.retrieved));
    await saveRaceForGuide(deps.db, job.guideId, guide.query, race, now());
    // Candidates are researched in this same job, so each contest finishes as a unit instead of
    // waiting behind every other contest's race lookup in the queue. A candidate that fails here
    // becomes its own job, which the queue retries with backoff.
    const retries: Job[] = [];
    await Promise.all(
      race.candidates.map(async (candidate) => {
        try {
          await researchCandidate(deps, tokens, job.guideId, race, candidate.id, now);
        } catch {
          retries.push({ type: "candidate", guideId: job.guideId, candidateId: candidate.id });
        }
      }),
    );
    await deps.enqueue(retries);
    return;
  }

  const race = guide.data?.race;
  if (!race) return;
  await researchCandidate(deps, tokens, job.guideId, race, job.candidateId, now);
}

async function researchCandidate(deps: JobDeps, tokens: GrokTokens, guideId: string, race: Race, candidateId: string, now: () => number): Promise<void> {
  const candidate = race.candidates.find((c) => c.id === candidateId);
  if (!candidate) return;
  const { data, retrieved } = await research(tokens, PROFILE_INSTRUCTIONS, profilePrompt(race, candidate), profileSchema, ignoreProgress).catch(permanent);
  const profile = alignPositions(keepRetrievedSources(data, retrieved), race.issues);
  await saveCandidateResult(deps.db, guideId, candidateId, { profile }, race.candidates.length, now());
}

/** Records a job that gave up, so the page shows what went wrong instead of researching forever. */
export async function failJob(job: Job, message: string, deps: JobDeps): Promise<void> {
  const now = (deps.now ?? Date.now)();
  if (job.type === "ballot") return setBallotStatus(deps.db, job.userId, "failed", message, now);
  if (job.type === "race") return setGuideStatus(deps.db, job.guideId, "failed", message, now);
  const guide = await guideForJob(deps.db, job.guideId);
  const count = guide?.data?.race.candidates.length ?? 0;
  if (count > 0) await saveCandidateResult(deps.db, job.guideId, job.candidateId, { error: message }, count, now);
}

export function readableError(err: unknown): string {
  if (err instanceof PermanentJobError || err instanceof ResearchError) return err.message;
  return "Research failed. Try again.";
}
