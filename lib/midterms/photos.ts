// Candidate photos found by scripts/build-photos.mjs, only where the person's identity is certain: official
// congressional portraits (public domain, github.com/unitedstates/images), Wikimedia Commons images, and campaign
// headshots from Ballotpedia, resized and served from public/midterms/photos/.
import photos from "./photos.json";
import type { RaceSummary } from "./view";

const table: Record<string, string> = photos;

/** Where a candidate's photo is listed: the race (as raceKey in odds.ts builds it) and the name as civicAPI spells it. */
export const photoKey = (race: Pick<RaceSummary, "office" | "state" | "district">, name: string) => `${race.office}:${race.state}:${race.office === "house" ? (race.district ?? 0) : ""}|${name}`;

/** A candidate's photo URL, small enough for an avatar, or null when there's none we're sure of. */
export function photoOf(race: Pick<RaceSummary, "office" | "state" | "district">, name: string): string | null {
  const entry = table[photoKey(race, name)];
  if (!entry) return null;
  const ref = entry.slice(2);
  if (entry.startsWith("c:")) return `https://unitedstates.github.io/images/congress/225x275/${ref}.jpg`;
  if (entry.startsWith("b:")) return `/midterms/photos/${ref}`;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(ref)}?width=96`;
}
