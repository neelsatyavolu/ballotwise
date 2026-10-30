import type { Districts } from "../ballot/census";
import { searchLive } from "./civic";
import { countyRacesFor, normal } from "./county";
import type { RaceSummary } from "./races";
import { STATE_NAMES } from "./view";

/**
 * The races near a saved address, for the "Near you" tab. `yours` are confirmed by the address's districts; `nearby`
 * are in its city or county but may be for a district it isn't in. `area` names the place, never the street.
 */
export type LocalRaces = { area: string; yours: RaceSummary[]; nearby: RaceSummary[]; source: "county" | "civicAPI"; fetchedAt: number; stale: boolean };
/** What /api/midterms/local answers: `local` is null until the voter saves an address. */
export type LocalAnswer = { fetchedAt: number; stale?: boolean; local: Omit<LocalRaces, "fetchedAt" | "stale"> | null };

/** "Palo Alto city" → "Palo Alto": the Census adds the kind of place to its names. */
const placeName = (place: string | null) => place?.replace(/\s+(city|town|village|borough|CDP|zona urbana)$/i, "") ?? null;

/** Whether `name` holds `phrase` as whole words, ignoring case and accents. */
const names = (name: string, phrase: string) => new RegExp(`\\b${normal(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(normal(name));

export async function localRaces(districts: Districts, now: number): Promise<LocalRaces> {
  const place = placeName(districts.place);
  const area = [place, districts.county, districts.state].filter(Boolean).join(", ");

  // Santa Clara County publishes every local contest; its city and school districts say which are on this ballot.
  if (districts.state === "California" && districts.county === "Santa Clara County") {
    const schools = [districts.schoolDistrict, districts.highSchoolDistrict].filter((s): s is string => !!s);
    return { area, source: "county", ...(await countyRacesFor({ city: districts.place, schools }, now)) };
  }

  // Elsewhere civicAPI is searched by the city's and county's names, keeping Nov 3 races in this state that name either.
  // Its search only finds school boards when asked for them, so that's searched too.
  const state = Object.keys(STATE_NAMES).find((code) => STATE_NAMES[code] === districts.state);
  const terms = [place, districts.county].filter((t): t is string => !!t);
  if (!state || !terms.length) return { area, source: "civicAPI", yours: [], nearby: [], fetchedAt: now, stale: false };
  const answers = await Promise.allSettled([...terms, `${terms[0]} school board`].map((query) => searchLive(query, now)));
  const answered = answers.flatMap((a) => (a.status === "fulfilled" ? [a.value] : []));
  if (!answered.length) throw (answers[0] as PromiseRejectedResult).reason;
  const seen = new Set<number>();
  const nearby = answered
    .flatMap((a) => a.races)
    .filter((r) => r.state === state && terms.some((t) => names(r.title, t)) && !seen.has(r.id) && seen.add(r.id));
  return { area, source: "civicAPI", yours: [], nearby, fetchedAt: now, stale: answered.length < answers.length || answered.some((a) => a.stale) };
}
