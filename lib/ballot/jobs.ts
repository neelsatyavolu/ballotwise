import { z } from "zod";
import type { Db } from "../auth/accounts";
import { getCached, knownContests, profileKey, putCached, raceKey, rememberContests } from "../cache";
import { refreshGrokTokens, type GrokTokens } from "../grok/oauth";
import { research, ResearchError, type Progress } from "../grok/research";
import { usableGrokTokens } from "../grok/vault";
import { estimateMissing, needsEstimate } from "../estimate";
import { guideForJob, guideProfiles, noteGuideActivity, replaceCandidateProfile, saveCandidateResult, saveRaceForGuide, setGuideStatus } from "../guides";
import { alignPositions, balanceSides, keepRetrievedRaceSources, keepRetrievedSources } from "../profile";
import { BALLOT_INSTRUCTIONS, ballotPrompt, PROFILE_INSTRUCTIONS, profilePrompt, RACE_INSTRUCTIONS, racePrompt } from "../prompts";
import { asJudicial, ballotContestsSchema, isJudicial, profileSchema, raceResultSchema, type CandidateRef, type Profile, type Race } from "../schema";
import { alignToIssues, getValues, releaseAlignment, saveSuggested, scheduleAlignment } from "../values";
import { addContestGuides, getBallot, noteBallotActivity, setBallotStatus, setJudgesChecked } from "./store";

export const jobSchema = z.discriminatedUnion("type", [
  // "judges" looks for judges alone, for a ballot found before they were covered.
  z.object({ type: z.literal("ballot"), userId: z.string(), only: z.literal("judges").optional() }),
  z.object({ type: z.literal("race"), guideId: z.string() }),
  z.object({ type: z.literal("candidate"), guideId: z.string(), candidateId: z.string() }),
  z.object({ type: z.literal("align"), guideId: z.string() }),
  z.object({ type: z.literal("estimate"), guideId: z.string() }),
]);
export type Job = z.infer<typeof jobSchema>;

export type JobDeps = { db: Db; tokenKey: string; enqueue: (jobs: Job[]) => Promise<void>; now?: () => number };

/** A failure that won't fix itself on retry, such as a missing Grok connection. */
export class PermanentJobError extends Error {}

const ACTIVITY_INTERVAL_MS = 1500;

/**
 * Turns Grok's progress events into occasional database writes for the live dashboard.
 * Writes are throttled and chained; searches between writes are added to the next one.
 */
export function activityReporter(write: (activity: string, newSearches: number) => Promise<void>, prefix = "") {
  let lastWrite = 0;
  let unsent = 0;
  let latest = "";
  let chain = Promise.resolve();
  const send = () => {
    const n = unsent;
    unsent = 0;
    const text = latest;
    chain = chain.then(() => write(text, n)).catch(() => {});
  };
  return {
    onProgress(p: Progress) {
      if (p.type === "search") unsent++;
      latest = `${prefix}${p.type === "search" ? `Searching: ${p.query}` : "Writing up what it found"}`;
      if (Date.now() - lastWrite >= ACTIVITY_INTERVAL_MS) {
        lastWrite = Date.now();
        send();
      }
    },
    flush(): Promise<void> {
      if (latest && unsent > 0) send();
      return chain;
    },
  };
}

/** Queues interview mapping only when a summary exists, so an early finish cannot burn the claim. */
async function enqueueAlignment(deps: JobDeps, userId: string, guideIds: string[]): Promise<void> {
  const now = (deps.now ?? Date.now)();
  await scheduleAlignment(
    deps.db,
    userId,
    guideIds,
    async (ids) => {
      await deps.enqueue(ids.map((guideId) => ({ type: "align" as const, guideId })));
    },
    now,
  );
}

async function tokensFor(deps: JobDeps, userId: string) {
  const tokens = await usableGrokTokens(deps.db, deps.tokenKey, userId, refreshGrokTokens);
  if (!tokens) throw new PermanentJobError("Grok isn't connected. Connect Grok, then refresh your ballot.");
  return tokens;
}

function permanent(err: unknown): never {
  // A rejected session or an unpaid account won't recover by retrying; rate limits and timeouts might.
  if (err instanceof ResearchError && (err.status === 401 || err.status === 402)) throw new PermanentJobError(err.message);
  throw err;
}

export async function runJob(job: Job, deps: JobDeps): Promise<void> {
  const now = deps.now ?? Date.now;
  if (job.type === "ballot") {
    const ballot = await getBallot(deps.db, job.userId);
    if (!ballot) return;
    const tokens = await tokensFor(deps, job.userId);
    const activity = activityReporter((text, n) => noteBallotActivity(deps.db, job.userId, text, n));
    const { state, county } = ballot.districts;
    const known = await knownContests(deps.db, state, county, now());
    const judgesOnly = job.only === "judges";
    const { data: answer } = await research(tokens, BALLOT_INSTRUCTIONS, ballotPrompt(ballot.matchedAddress, ballot.districts, known, judgesOnly), ballotContestsSchema, activity.onProgress)
      .catch(permanent)
      .finally(() => activity.flush());
    // A judges-only search never adds anything else, so the ballot's other races stay exactly as they were.
    const data = judgesOnly ? { elections: answer.elections.map((e) => ({ ...e, contests: e.contests.filter((c) => c.level === "judicial") })) } : answer;
    const found = data.elections.flatMap((e) => e.contests.map((c) => ({ label: c.label, query: c.query, date: e.date })));
    await rememberContests(deps.db, state, county, found, now());
    const added = await addContestGuides(deps.db, job.userId, data, now());
    await deps.enqueue(added.map((guideId) => ({ type: "race", guideId })));
    // Every search now includes judges, so a finished one settles the offer to look for them.
    await setJudgesChecked(deps.db, job.userId);
    await setBallotStatus(deps.db, job.userId, "ready", null, now());
    return;
  }

  const guide = await guideForJob(deps.db, job.guideId);
  if (!guide) return; // Deleted while queued.
  const tokens = await tokensFor(deps, guide.userId);

  if (job.type === "race") {
    await setGuideStatus(deps.db, job.guideId, "researching", null, now());
    const found = (await getCached<Race>(deps.db, raceKey(guide.query), now())) ?? (await researchRace(deps, tokens, job.guideId, guide.query, now));
    // A contest the ballot search filed under judges is a judge's, even when the race lookup laid it out as an office.
    const race = guide.level === "judicial" && !isJudicial(found) && found.kind !== "measure" ? asJudicial(found) : found;
    await saveRaceForGuide(deps.db, job.guideId, guide.query, race, now());
    // Shared profiles are reused only as a full set. If any candidate's is missing, all are researched
    // again, so no candidate is compared using older research than an opponent's.
    const cached = await Promise.all(race.candidates.map((c) => getCached<Profile>(deps.db, profileKey(race, c), now())));
    const reuse = cached.every(Boolean);
    // Candidates are researched in this same job, so each contest finishes as a unit instead of
    // waiting behind every other contest's race lookup in the queue. A candidate that fails here
    // becomes its own job, which the queue retries with backoff.
    const retries: Job[] = [];
    await Promise.all(
      race.candidates.map(async (candidate) => {
        try {
          await researchCandidate(deps, tokens, guide.userId, job.guideId, race, candidate.id, now, reuse);
        } catch {
          retries.push({ type: "candidate", guideId: job.guideId, candidateId: candidate.id });
        }
      }),
    );
    await deps.enqueue(retries);
    return;
  }

  if (job.type === "align") {
    // A judge has no issues to place the voter on. An empty mapping marks it done so it's never queued again.
    if (guide.data && isJudicial(guide.data.race)) {
      await saveSuggested(deps.db, job.guideId, {});
      return;
    }
    const values = await getValues(deps.db, guide.userId);
    // Research often finishes before the interview. Releasing the claim lets the
    // interview (or the next ballot load) queue this race again.
    if (!values.summary || !guide.data) {
      await releaseAlignment(deps.db, job.guideId);
      return;
    }
    const suggested = await alignToIssues(tokens, values.summary, guide.data.race.title, guide.data.race.issues).catch(permanent);
    await saveSuggested(deps.db, job.guideId, suggested);
    return;
  }

  if (job.type === "estimate") {
    const race = guide.data?.race;
    if (!race) return;
    for (const [candidateId, found] of Object.entries(await guideProfiles(deps.db, job.guideId))) {
      const candidate = race.candidates.find((c) => c.id === candidateId);
      if (!candidate || !needsEstimate(found)) continue;
      const profile = await estimateMissing(tokens, race, candidate, found);
      if (profile === found) continue;
      await replaceCandidateProfile(deps.db, job.guideId, candidateId, profile);
      await putCached(deps.db, profileKey(race, candidate), profile, now());
    }
    return;
  }

  const race = guide.data?.race;
  if (!race) return;
  await researchCandidate(deps, tokens, guide.userId, job.guideId, race, job.candidateId, now);
}

/** Looks up who is running in one contest and shares the result with every voter who has the same contest. */
async function researchRace(deps: JobDeps, tokens: GrokTokens, guideId: string, query: string, now: () => number): Promise<Race> {
  const activity = activityReporter((text) => noteGuideActivity(deps.db, guideId, text), "Finding who's running. ");
  let result = await research(tokens, RACE_INSTRUCTIONS, racePrompt(query), raceResultSchema, activity.onProgress).catch(permanent);
  // The query names one contest, so an ambiguous answer gets one more try with Grok's most specific option.
  if (result.data.kind === "choose") {
    result = await research(tokens, RACE_INSTRUCTIONS, racePrompt(result.data.options[0].query), raceResultSchema, activity.onProgress).catch(permanent);
  }
  await activity.flush();
  if (result.data.kind !== "race") {
    const reason = result.data.kind === "none" ? result.data.reason : "Grok couldn't pin down this contest.";
    throw new PermanentJobError(reason);
  }
  const race = balanceSides(keepRetrievedRaceSources(result.data.race, result.retrieved));
  await putCached(deps.db, raceKey(query), race, now());
  return race;
}

async function researchCandidate(deps: JobDeps, tokens: GrokTokens, userId: string, guideId: string, race: Race, candidateId: string, now: () => number, useCache = true): Promise<void> {
  const candidate = race.candidates.find((c) => c.id === candidateId);
  if (!candidate) return;
  const cached = useCache ? await getCached<Profile>(deps.db, profileKey(race, candidate), now()) : null;
  const found = cached ?? (await researchProfile(deps, tokens, guideId, race, candidate));
  const profile = await estimateMissing(tokens, race, candidate, found);
  if (profile !== cached) await putCached(deps.db, profileKey(race, candidate), profile, now());
  const status = await saveCandidateResult(deps.db, guideId, candidateId, { profile }, race.candidates.length, now());
  // Once the last candidate is in, place the voter's interview on this race's issues.
  // Skip it when the interview isn't done yet; finishing the interview queues these races.
  if (status === "ready") await enqueueAlignment(deps, userId, [guideId]);
}

async function researchProfile(deps: JobDeps, tokens: GrokTokens, guideId: string, race: Race, candidate: CandidateRef): Promise<Profile> {
  const activity = activityReporter((text) => noteGuideActivity(deps.db, guideId, text), `${candidate.name}. `);
  const { data, retrieved } = await research(tokens, PROFILE_INSTRUCTIONS, profilePrompt(race, candidate), profileSchema, activity.onProgress)
    .catch(permanent)
    .finally(() => activity.flush());
  return alignPositions(keepRetrievedSources(data, retrieved), race.issues);
}

/** Records a job that gave up, so the page shows what went wrong instead of researching forever. */
export async function failJob(job: Job, message: string, deps: JobDeps): Promise<void> {
  const now = (deps.now ?? Date.now)();
  if (job.type === "ballot") return setBallotStatus(deps.db, job.userId, "failed", message, now);
  if (job.type === "race") return setGuideStatus(deps.db, job.guideId, "failed", message, now);
  if (job.type === "align") {
    // Leave the race ready, but stop the card spinning. A retry clears this and queues the job again.
    await deps.db.prepare("UPDATE guides SET error = ? WHERE id = ? AND status = 'ready' AND suggested IS NULL").bind(message, job.guideId).run();
    return;
  }
  if (job.type === "estimate") return; // Estimates are best effort; the match uses what is already known.
  const guide = await guideForJob(deps.db, job.guideId);
  const count = guide?.data?.race.candidates.length ?? 0;
  if (count === 0) return;
  const status = await saveCandidateResult(deps.db, job.guideId, job.candidateId, { error: message }, count, now);
  if (status === "ready" && guide) await enqueueAlignment(deps, guide.userId, [job.guideId]);
}

export function readableError(err: unknown): string {
  if (err instanceof PermanentJobError || err instanceof ResearchError) return err.message;
  return "Research failed. Try again.";
}
