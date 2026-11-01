// Candidate photos found by scripts/build-photos.mjs, only where the person's identity is certain: official
// congressional portraits (public domain, github.com/unitedstates/images), Wikimedia Commons images, and campaign
// headshots from Ballotpedia, resized and served from public/midterms/photos/.
import photos from "./photos.json";
import { sameCandidate } from "./picks";
import type { RaceSummary } from "./view";

const table: Record<string, string> = photos;

/** Each race's listed names and photos, keyed by the part of photoKey before the "|". */
let byRace: Map<string, [string, string][]> | null = null;

function raceEntries(race: string): [string, string][] {
  if (!byRace) {
    byRace = new Map();
    for (const [key, entry] of Object.entries(table)) {
      const at = key.indexOf("|");
      const list = byRace.get(key.slice(0, at)) ?? [];
      byRace.set(key.slice(0, at), [...list, [key.slice(at + 1), entry]]);
    }
  }
  return byRace.get(race) ?? [];
}

/**
 * The race's photo for `name`: its exact listing, else the one person in the race listed under another spelling.
 * Decision Desk HQ often drops the middle names civicAPI keeps ("Peter Soulé" for "Peter Sundin Soulé").
 */
function entryOf(race: Pick<RaceSummary, "office" | "state" | "district">, name: string): string | undefined {
  const key = photoKey(race, name.trim());
  if (table[key]) return table[key];
  const same = raceEntries(key.slice(0, key.indexOf("|"))).filter(([listed]) => sameCandidate(listed, name));
  return same.length === 1 ? same[0][1] : undefined;
}

/** Where a candidate's photo is listed: the race (as raceKey in odds.ts builds it) and the name as civicAPI spells it. */
export const photoKey = (race: Pick<RaceSummary, "office" | "state" | "district">, name: string) => `${race.office}:${race.state}:${race.office === "house" ? (race.district ?? 0) : ""}|${name}`;

/** A candidate's photo URL, small enough for an avatar, or null when there's none we're sure of. */
export function photoOf(race: Pick<RaceSummary, "office" | "state" | "district">, name: string): string | null {
  const entry = entryOf(race, name);
  if (!entry) return null;
  const ref = entry.slice(2);
  if (entry.startsWith("c:")) return `https://unitedstates.github.io/images/congress/225x275/${ref}.jpg`;
  if (entry.startsWith("b:")) return `/midterms/photos/${ref}`;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(ref)}?width=96`;
}
