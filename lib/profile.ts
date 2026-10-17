import type { Issue, Position, Profile, Race, Sourced } from "./schema";
import { normalizeUrl } from "./url";

const NO_POSITION = "We couldn't find where they stand on this.";

/**
 * Lines a profile up with the race's issues: one position per issue, in race order.
 * A stance without a source is dropped, because an unsourced stance is a guess.
 */
export function alignPositions(profile: Profile, issues: readonly Issue[]): Profile {
  const positions: Position[] = issues.map((issue) => {
    const found = profile.positions.find((p) => p.issueId === issue.id);
    if (!found || found.sources.length === 0) {
      return { issueId: issue.id, stance: null, summary: NO_POSITION, quote: null, sources: [] };
    }
    return { ...found, summary: found.summary || NO_POSITION };
  });
  return { ...profile, positions };
}

/** Keeps only citations Grok actually retrieved during this request. Claims left with no source are removed. */
export function keepRetrievedSources(profile: Profile, retrieved: ReadonlySet<string>): Profile {
  if (retrieved.size === 0) return profile;
  const ok = (url: string) => retrieved.has(normalizeUrl(url));
  const claims = (list: readonly Sourced[]) =>
    list.map((c) => ({ ...c, sources: c.sources.filter(ok) })).filter((c) => c.sources.length > 0);
  const funding = profile.funding ? claims([profile.funding])[0] ?? null : null;
  return {
    ...profile,
    background: claims(profile.background),
    record: claims(profile.record),
    endorsements: claims(profile.endorsements),
    funding,
    positions: profile.positions.map((p) => ({ ...p, sources: p.sources.filter(ok) })),
  };
}

/** Same rule for the race lookup's citations. */
export function keepRetrievedRaceSources(race: Race, retrieved: ReadonlySet<string>): Race {
  if (retrieved.size === 0) return race;
  const ok = (url: string) => retrieved.has(normalizeUrl(url));
  return { ...race, sources: race.sources.filter(ok), office: { ...race.office, sources: race.office.sources.filter(ok) } };
}

/**
 * Grok tends to list the same camp's view first on every issue. Each issue gets a coin flip
 * for which side is shown first, so neither camp is always "side A". Runs before candidates are scored.
 */
export function balanceSides(race: Race, random: () => number = Math.random): Race {
  return {
    ...race,
    issues: race.issues.map((issue) => (random() < 0.5 ? issue : { ...issue, sideA: issue.sideB, sideB: issue.sideA })),
  };
}
