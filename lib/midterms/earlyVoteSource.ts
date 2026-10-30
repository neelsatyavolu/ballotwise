// Fetches civicAPI's early vote tracker and keeps each answer for a while: states publish once or twice a day.
import { z } from "zod";
import { civic, CivicNotFound, pooled } from "./civic";
import names from "./countyNames.json";
import { breakdown, countiesOf, earlyFeed, nationOf, priorDate, priorOf, stateTotals, type Demographics, type EarlyFeed, type EarlyNation, type EarlyStateDetail, type Feeds } from "./earlyVote";

/** How long a fetched answer is reused before asking civicAPI again. */
const FRESH_MS = 10 * 60_000;
/** A whole state's fetch (a dozen requests) gives up after this long. */
const BUDGET_MS = 20_000;
const KINDS = ["returned", "inperson", "requested"] as const;
/** The demographic breakdowns shown, with civicAPI's names for them in its capabilities list and its `by` parameter. */
const DEMOGRAPHICS = [
  { kind: "age", capability: "age", by: "age_range" },
  { kind: "gender", capability: "gender", by: "gender" },
  { kind: "race", capability: "race", by: "race" },
] as const;

const capabilities = z.object({ categories: z.record(z.string(), z.record(z.string(), z.boolean())).nullish() });
const demographics = z.object({ values: z.record(z.string(), z.number()).default({}) });

export class EarlyVoteMissing extends Error {}

const memo = new Map<string, { at: number; value: unknown }>();
const inFlight = new Map<string, Promise<unknown>>();

/**
 * `load()`'s answer under `key`, reused for FRESH_MS and shared by requests arriving together. When a refresh fails,
 * the last answer is served instead, as long as there is one.
 */
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const held = memo.get(key);
  if (held && Date.now() - held.at < FRESH_MS) return held.value as T;
  const running = inFlight.get(key);
  if (running) return running as Promise<T>;
  const work = load()
    .then((value) => {
      memo.set(key, { at: Date.now(), value });
      return value;
    })
    .catch((err) => {
      if (held && !(err instanceof EarlyVoteMissing)) {
        console.error(`early vote: refresh of ${key} failed, serving the last answer:`, err);
        return held.value as T;
      }
      throw err;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, work);
  return work;
}

/** A feed, or null when civicAPI has none for it. */
async function feed(path: string, deadline: number): Promise<EarlyFeed | null> {
  try {
    return earlyFeed.parse(await civic(`early-vote/${path}`, deadline));
  } catch (err) {
    if (err instanceof CivicNotFound) return null;
    throw err;
  }
}

const empty: EarlyFeed = { snapshot_date: null, regions: {}, statewide_total: {} };

async function feedsFor(state: string, deadline: number): Promise<{ feeds: Feeds; found: boolean }> {
  const [returned, inperson, requested] = await Promise.all(KINDS.map((k) => feed(`${state}/${k}`, deadline)));
  return { feeds: { returned: returned ?? empty, inperson: inperson ?? empty, requested: requested ?? empty }, found: !!(returned || inperson || requested) };
}

/** Every reporting state's counts. */
export function earlyNation(): Promise<EarlyNation> {
  return cached("US", async () => {
    const { feeds, found } = await feedsFor("US", Date.now() + BUDGET_MS);
    if (!found) throw new EarlyVoteMissing("civicAPI has no early vote data yet.");
    return { fetchedAt: Date.now(), ...nationOf(feeds) };
  });
}

/** The breakdowns the state reports, mail and in-person ballots together. A failed breakdown is left out. */
async function demographicsOf(state: string, deadline: number): Promise<Demographics> {
  let caps: z.infer<typeof capabilities>["categories"];
  try {
    caps = capabilities.parse(await civic(`early-vote/${state}/capabilities`, deadline)).categories;
  } catch {
    return {};
  }
  const jobs = DEMOGRAPHICS.flatMap((d) => (["returned", "inperson"] as const).filter((k) => caps?.[k]?.[d.capability]).map((k) => ({ ...d, category: k })));
  const answers = await pooled(jobs, 3, async (job) => {
    try {
      return { kind: job.kind, values: demographics.parse(await civic(`early-vote/${state}/${job.category}/demographics?by=${job.by}`, deadline)).values };
    } catch (err) {
      console.error(`early vote: ${state} ${job.category} ${job.by} breakdown failed:`, err);
      return null;
    }
  });
  const out: Demographics = {};
  for (const { kind } of DEMOGRAPHICS) {
    const rows = breakdown(kind, answers.filter((a) => a?.kind === kind).map((a) => a!.values));
    if (rows) out[kind] = rows;
  }
  return out;
}

/** One state's totals, counties, demographics and the same day in 2024. Throws EarlyVoteMissing when it has none. */
export function earlyState(state: string): Promise<EarlyStateDetail> {
  return cached(state, async () => {
    const deadline = Date.now() + BUDGET_MS;
    const { feeds, found } = await feedsFor(state, deadline);
    if (!found) throw new EarlyVoteMissing("No early vote numbers for this state yet.");
    const totals = stateTotals(state, feeds);
    const date = totals.asOf ? priorDate(totals.asOf) : null;
    const [prior, demo] = await Promise.all([
      date
        ? Promise.all([feed(`historical/2024/${state}/returned?date=${date}`, deadline), feed(`historical/2024/${state}/inperson?date=${date}`, deadline)])
            .then(([r, i]) => priorOf(date, r, i))
            .catch(() => null)
        : null,
      demographicsOf(state, deadline),
    ]);
    const { counties, byTown } = countiesOf(feeds, (names as Record<string, Record<string, string>>)[state] ?? {});
    return { fetchedAt: Date.now(), state, ...totals, counties, byTown, prior, demographics: demo };
  });
}
