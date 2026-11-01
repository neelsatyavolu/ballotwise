import townNames from "./townNames.json";

// The six New England states report by town, not county. civicAPI names the towns without codes, so they're matched
// by name to the Census Bureau's county subdivisions (scripts/build-towns.mjs), whose 10-digit GEOIDs key the town maps.

/** Each town-reporting state's towns, by GEOID: "2300102060" → "Auburn city". */
export const TOWN_NAMES = townNames as Record<string, Record<string, string>>;

/** What a place name becomes when civicAPI and the Census both write it: "Saint Albans City" and "St. Albans city" agree. */
const placeKey = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ'’.]/g, "")
    .replace(/\bsaint\b/g, "st")
    .replace(/\bplt\b/g, "plantation")
    .replace(/\btwp\b/g, "township")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const KIND = / (town|city|plantation|township|gore|grant|location|purchase|ut)$/;
const WARD = / ward \d+$/;

type Index = { full: Map<string, string>; bare: Map<string, string[]> };
const indexes = new Map<string, Index>();

function indexOf(state: string): Index | null {
  const towns = TOWN_NAMES[state];
  if (!towns) return null;
  if (!indexes.has(state)) {
    const full = new Map<string, string>();
    const bare = new Map<string, string[]>();
    for (const [code, name] of Object.entries(towns)) {
      const key = placeKey(name);
      full.set(key, code);
      // Massachusetts calls some towns cities ("Agawam Town city"), so a second kind comes off too.
      const stem = key.replace(KIND, "").replace(KIND, "");
      bare.set(stem, [...(bare.get(stem) ?? []), code]);
    }
    indexes.set(state, { full, bare });
  }
  return indexes.get(state)!;
}

/**
 * A place's town code: its exact Census name ("Barre City", "Rangeley Plantation"), else its bare name when only one
 * town has it or one of those is the town or city itself ("Rangeley" is the town, not the plantation). civicAPI calls a
 * town that shares its county's name a township ("Barnstable Township"), and a city ward ("Manchester Ward 3") is its
 * city. Null for anything else: overseas ballots, planning regions.
 */
function townOf(index: Index, towns: Record<string, string>, name: string): string | null {
  const key = placeKey(name).replace(WARD, "");
  const exact = index.full.get(key);
  if (exact) return exact;
  const found = index.bare.get(key.replace(KIND, "")) ?? [];
  if (found.length === 1) return found[0];
  const proper = found.filter((code) => / (town|city)$/.test(towns[code]));
  return proper.length === 1 ? proper[0] : null;
}

/**
 * Each place's town code in a town-reporting state, or null for the whole list in any other state. A place civicAPI
 * gives a county FIPS code is a county subtotal, not a town. Wards share their city's code, to be summed; two places
 * that aren't wards landing on one town can't both be it, so neither is mapped.
 */
export function townCodes(state: string, places: readonly { name: string; fips?: string | null }[]): (string | null)[] | null {
  const index = indexOf(state);
  if (!index) return null;
  const towns = TOWN_NAMES[state];
  const codes = places.map((p) => (p.fips ? null : townOf(index, towns, p.name)));
  const claims = new Map<string, number>();
  places.forEach((p, i) => {
    const code = codes[i];
    if (code && !WARD.test(placeKey(p.name))) claims.set(code, (claims.get(code) ?? 0) + 1);
  });
  return codes.map((code) => (code && (claims.get(code) ?? 0) > 1 ? null : code));
}
