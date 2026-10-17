/** Address suggestions from Photon (OpenStreetMap), formatted the way the Census geocoder matches best. */

const STATES: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE",
  "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
  Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN",
  Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ",
  "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR",
  Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT",
  Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY", "Puerto Rico": "PR",
};

export type PhotonFeature = {
  properties: {
    countrycode?: string;
    housenumber?: string;
    street?: string;
    name?: string;
    city?: string;
    town?: string;
    village?: string;
    district?: string;
    county?: string;
    state?: string;
    postcode?: string;
  };
};

export type AddressSuggestion = { address: string; line1: string; line2: string };

/** A full US street address, or null for anything the Census couldn't match (no house number, not in the US). */
export function toSuggestion(feature: PhotonFeature): AddressSuggestion | null {
  const p = feature.properties;
  const street = p.street ?? p.name;
  const city = p.city ?? p.town ?? p.village ?? p.district;
  if (p.countrycode?.toUpperCase() !== "US" || !p.housenumber || !street || !city || !p.state) return null;
  const state = STATES[p.state] ?? p.state;
  const line1 = `${p.housenumber} ${street}`;
  const line2 = [`${city}, ${state}`, p.postcode?.split(";")[0]].filter(Boolean).join(" ");
  return { address: `${line1}, ${line2}`, line1, line2 };
}

export function toSuggestions(features: PhotonFeature[], limit = 5): AddressSuggestion[] {
  const seen = new Set<string>();
  const out: AddressSuggestion[] = [];
  for (const f of features) {
    const s = toSuggestion(f);
    if (!s || seen.has(s.address)) continue;
    seen.add(s.address);
    out.push(s);
    if (out.length === limit) break;
  }
  return out;
}

const PHOTON = "https://photon.komoot.io/api/";

export async function suggestAddresses(query: string, near?: { lat: number; lon: number }): Promise<AddressSuggestion[]> {
  const params = new URLSearchParams({ q: query, limit: "12", lang: "en", layer: "house" });
  if (near) {
    params.set("lat", String(near.lat));
    params.set("lon", String(near.lon));
  }
  const res = await fetch(`${PHOTON}?${params}`, {
    headers: { "user-agent": "Ballotwise (https://ballotwise.xanom.co)" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Photon failed (${res.status})`);
  const json = (await res.json()) as { features?: PhotonFeature[] };
  return toSuggestions(json.features ?? []);
}
