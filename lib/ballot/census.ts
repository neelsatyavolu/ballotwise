import { z } from "zod";

/** The districts an address votes in, from the US Census geocoder's current boundary files. */
export const districtsSchema = z.object({
  state: z.string(),
  county: z.string().nullable(),
  place: z.string().nullable(),
  congressional: z.string().nullable(),
  stateSenate: z.string().nullable(),
  stateHouse: z.string().nullable(),
  schoolDistrict: z.string().nullable(),
});
export type Districts = z.infer<typeof districtsSchema>;

const GEOCODER = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";

type Geo = Record<string, { NAME?: string; BASENAME?: string }[]>;

/** Layer names carry a year or congress number ("120th Congressional Districts"), so they are matched by pattern. */
function pick(geos: Geo, pattern: RegExp): string | null {
  const key = Object.keys(geos).find((k) => pattern.test(k));
  const first = key ? geos[key]?.[0] : undefined;
  return first?.NAME ?? first?.BASENAME ?? null;
}

export function districtsFrom(geos: Geo): Districts | null {
  const state = pick(geos, /^States$/);
  if (!state) return null;
  return {
    state,
    county: pick(geos, /^Counties$/),
    place: pick(geos, /^Incorporated Places$/) ?? pick(geos, /^Census Designated Places$/),
    congressional: pick(geos, /Congressional Districts$/),
    stateSenate: pick(geos, /State Legislative Districts - Upper$/),
    stateHouse: pick(geos, /State Legislative Districts - Lower$/),
    schoolDistrict: pick(geos, /^Unified School Districts$/) ?? pick(geos, /^Elementary School Districts$/),
  };
}

/** Null when the Census can't match the address to a single US location. */
export async function lookUpDistricts(address: string): Promise<{ matchedAddress: string; districts: Districts } | null> {
  const url = new URL(GEOCODER);
  url.search = new URLSearchParams({ address, benchmark: "Public_AR_Current", vintage: "Current_Current", layers: "all", format: "json" }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Census geocoder failed (${res.status})`);
  const json = (await res.json()) as { result?: { addressMatches?: { matchedAddress: string; geographies: Geo }[] } };
  const match = json.result?.addressMatches?.[0];
  if (!match) return null;
  const districts = districtsFrom(match.geographies);
  return districts ? { matchedAddress: match.matchedAddress, districts } : null;
}
