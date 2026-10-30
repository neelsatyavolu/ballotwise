import type { Districts } from "../ballot/census";
import { searchLive } from "./civic";
import { countyRacesFor, normal } from "./county";
import type { RaceSummary } from "./races";
import { STATE_NAMES } from "./view";

/**
 * The races near a saved address, for the "Near you" tab. `yours` are confirmed by the address's districts; `nearby`
 * are in its city or county but may be for a district it isn't in; `legislature` holds its state senate and house
 * seats. `state` and `house` (0 at-large) pick out its tracked races (governor, Senate, House, statewide measures),
 * which the page already has. `area` names the place, never the street.
 */
export type LocalRaces = {
  area: string;
  state: string | null;
  house: number | null;
  legislature: RaceSummary[];
  yours: RaceSummary[];
  nearby: RaceSummary[];
  source: "county" | "civicAPI";
  fetchedAt: number;
  stale: boolean;
};
/** What /api/midterms/local answers: `local` is null until the voter saves an address. */
export type LocalAnswer = { fetchedAt: number; stale?: boolean; local: Omit<LocalRaces, "fetchedAt" | "stale"> | null };
type CityAndCounty = Pick<LocalRaces, "yours" | "nearby" | "source" | "fetchedAt" | "stale">;

/** "Palo Alto city" → "Palo Alto": the Census adds the kind of place to its names. */
const placeName = (place: string | null) => place?.replace(/\s+(city|town|village|borough|CDP|zona urbana)$/i, "") ?? null;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whether `name` holds `phrase` as whole words, ignoring case and accents. */
const names = (name: string, phrase: string) => new RegExp(`\\b${escapeRe(normal(phrase))}\\b`).test(normal(name));

/** "Congressional District 16" → 16, "Congressional District (at Large)" → 0, as the tracked House races number them. */
function houseDistrict(name: string | null): number | null {
  if (!name) return null;
  if (/at large/i.test(name)) return 0;
  const n = name.match(/(\d+)\s*$/);
  return n ? Number(n[1]) : null;
}

/** civicAPI's name for each state's lower chamber, where it isn't "State House". */
const LOWER: Record<string, string> = { CA: "State Assembly", NV: "State Assembly", NY: "State Assembly", WI: "State Assembly", NJ: "State Assembly", MD: "House of Delegates", VA: "House of Delegates", WV: "House of Delegates" };

/**
 * The address's state senate and house seats on civicAPI. Its search matches loosely ("State House 5" finds 35 and
 * 159), so the seat is the race whose name ends in the district exactly ("12A", not "12B"). A failed search leaves
 * its seat out and marks the answer stale.
 */
async function legislature(districts: Districts, state: string, now: number): Promise<{ races: RaceSummary[]; stale: boolean }> {
  const seats = [
    { name: districts.stateSenate, chamber: "State Senate", type: "State Senate" },
    { name: districts.stateHouse, chamber: LOWER[state] ?? "State House", type: "State House" },
  ].flatMap((seat) => {
    const district = seat.name?.trim().match(/(\d+[A-Za-z]?)$/)?.[1].replace(/^0+/, "");
    return district ? [{ ...seat, district }] : [];
  });
  const answers = await Promise.allSettled(seats.map((seat) => searchLive(`${districts.state} ${seat.chamber} ${seat.district}`, now)));
  const races = answers.flatMap((answer, i) => {
    if (answer.status !== "fulfilled") return [];
    const { type, district } = seats[i];
    return answer.value.races.filter((r) => r.state === state && r.local?.type === type && new RegExp(`\\s0*${escapeRe(district)}$`, "i").test(r.title)).slice(0, 1);
  });
  return { races, stale: answers.some((a) => a.status === "rejected" || a.value.stale) };
}

async function cityAndCounty(districts: Districts, state: string | null, place: string | null, now: number): Promise<CityAndCounty> {
  // Santa Clara County publishes every local contest; its city and school districts say which are on this ballot.
  if (districts.state === "California" && districts.county === "Santa Clara County") {
    const schools = [districts.schoolDistrict, districts.highSchoolDistrict].filter((s): s is string => !!s);
    return { source: "county", ...(await countyRacesFor({ city: districts.place, schools }, now)) };
  }

  // Elsewhere civicAPI is searched by the city's and county's names, keeping Nov 3 races in this state that name either.
  // Its search only finds school boards when asked for them, so that's searched too.
  const terms = [place, districts.county].filter((t): t is string => !!t);
  if (!state || !terms.length) return { source: "civicAPI", yours: [], nearby: [], fetchedAt: now, stale: false };
  const answers = await Promise.allSettled([...terms, `${terms[0]} school board`].map((query) => searchLive(query, now)));
  const answered = answers.flatMap((a) => (a.status === "fulfilled" ? [a.value] : []));
  if (!answered.length) throw (answers[0] as PromiseRejectedResult).reason;
  const seen = new Set<number>();
  const nearby = answered
    .flatMap((a) => a.races)
    .filter((r) => r.state === state && terms.some((t) => names(r.title, t)) && !seen.has(r.id) && seen.add(r.id));
  return { source: "civicAPI", yours: [], nearby, fetchedAt: now, stale: answered.length < answers.length || answered.some((a) => a.stale) };
}

export async function localRaces(districts: Districts, now: number): Promise<LocalRaces> {
  const place = placeName(districts.place);
  const area = [place, districts.county, districts.state].filter(Boolean).join(", ");
  const state = Object.keys(STATE_NAMES).find((code) => STATE_NAMES[code] === districts.state) ?? null;
  const [local, seats] = await Promise.all([cityAndCounty(districts, state, place, now), state ? legislature(districts, state, now) : { races: [], stale: false }]);
  return { area, state, house: houseDistrict(districts.congressional), legislature: seats.races, ...local, stale: local.stale || seats.stale };
}
