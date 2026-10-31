import type { MatchHeadline } from "../match";
import type { RaceKind } from "../schema";
import type { RaceSummary } from "./races";
import { STATE_NAMES } from "./view";

/** One of the voter's finished guides for election day, with its best match, for marking their pick on the tracker. */
export type GuidePick = { guideId: string; kind: RaceKind; title: string; jurisdiction: string; candidates: string[]; match: MatchHeadline };

/** The voter's pick in one tracked race: the race's own spelling of each picked name, and the guide it came from. */
export type RacePick = { names: string[]; pick: GuidePick };

const SUFFIX = /^(jr|sr|ii|iii|iv)$/;

/** A name's words, without accents, punctuation, nicknames in quotes, suffixes or middle initials. */
function words(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/["“”][^"“”]*["“”]|\([^)]*\)/g, " ")
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/['-]/g, "")
    .split(/\s+/)
    .filter((w) => w && !SUFFIX.test(w));
}

/**
 * Whether two spellings name the same person: the same surname, and first names that agree (one may be an initial).
 * A guide's research and civicAPI often differ on middle names, suffixes and accents.
 */
export function sameCandidate(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (!x.length || !y.length || x.at(-1) !== y.at(-1)) return false;
  if (x.length === 1 || y.length === 1) return true;
  const [f, g] = [x[0], y[0]];
  return f === g || (f.length === 1 && g.startsWith(f)) || (g.length === 1 && f.startsWith(g));
}

const plain = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** "Proposition 37: Creates…" and "California Proposition 37" → "proposition 37"; "Measure J" → "measure j". */
function measureKey(title: string): string | null {
  const m = plain(title).match(/\b(proposition|prop|measure|question|amendment|issue|initiative|referendum)\.?\s+(?:no\.?\s+)?(\d+[a-z]?|[a-z]{1,2})\b/);
  return m ? `${m[1] === "prop" ? "proposition" : m[1]} ${m[2]}` : null;
}

/** "State of California" → "california", "City of Palo Alto, California" → "palo alto": the place a measure is voted on. */
const placeOf = (jurisdiction: string) => plain(jurisdiction).split(",")[0].replace(/^(state|city|county|town|village) of\s+/, "").trim();

/**
 * The voter's side on a ballot measure: the guide for the same numbered measure in the same place (the state, or the
 * city or county named in the race's title), and the race's Yes or No row matching the side the guide picked.
 */
function measurePick(race: RaceSummary, picks: readonly GuidePick[]): RacePick | null {
  const key = measureKey(race.title);
  if (!key) return null;
  const title = plain(race.title);
  for (const pick of picks) {
    if (pick.kind !== "measure" || measureKey(pick.title) !== key) continue;
    const place = placeOf(pick.jurisdiction);
    if (!place || (place !== plain(STATE_NAMES[race.state] ?? "") && !title.includes(place))) continue;
    const names = pick.match.picks.map((p) => race.candidates.find((c) => plain(c.name).split(/\s+/)[0] === plain(p.name).split(/\s+/)[0])?.name);
    if (names.length && names.every(Boolean)) return { names: names as string[], pick };
  }
  return null;
}

/**
 * The voter's pick in `race`, from the guide sharing the most candidates with it. A guide counts only when its picks
 * are in the race and, unless it has a single candidate, so is at least one other of its candidates, so two people
 * with the same name in different races don't match. Measures match by number and place instead (see measurePick):
 * every measure's sides are Yes and No.
 */
export function pickIn(race: RaceSummary, picks: readonly GuidePick[]): RacePick | null {
  if (race.office === "measure" && race.local?.kind !== "candidates") return measurePick(race, picks);
  let best: { found: RacePick; shared: number } | null = null;
  for (const pick of picks) {
    if (pick.kind === "measure") continue;
    const inRace = (name: string) => race.candidates.find((c) => sameCandidate(c.name, name))?.name;
    const names = pick.match.picks.map((p) => inRace(p.name));
    if (!names.length || names.some((n) => !n)) continue;
    const shared = pick.candidates.filter((name) => inRace(name)).length;
    if (shared < Math.min(2, pick.candidates.length)) continue;
    if (!best || shared > best.shared) best = { found: { names: names as string[], pick }, shared };
  }
  return best?.found ?? null;
}
