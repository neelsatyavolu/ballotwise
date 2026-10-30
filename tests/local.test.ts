import { afterEach, describe, expect, it, vi } from "vitest";
import type { Districts } from "../lib/ballot/census";
import { resetCivicMemo } from "../lib/midterms/civic";
import { COUNTY_ID_BASE, resetCountyMemo } from "../lib/midterms/county";
import { localRaces } from "../lib/midterms/local";
import { FIRST_POLLS_OPEN } from "../lib/midterms/races";

const AFTER_POLLS = FIRST_POLLS_OPEN + 3_600_000;
const NOV_3 = "2026-11-03T05:00:00.000Z";

const base: Districts = { state: "", county: null, place: null, congressional: null, stateSenate: null, stateHouse: null, schoolDistrict: null };
const paloAlto: Districts = { ...base, state: "California", county: "Santa Clara County", place: "Palo Alto city", schoolDistrict: "Palo Alto Unified School District" };
const greenville: Districts = { ...base, state: "South Carolina", county: "Greenville County", place: "Greenville city" };

const clarity = [
  { CAT: "School", C: "Palo Alto Unified SD", K: "42", VF: 2, TP: 22, PR: 11, CH: ["Avery Wang", "John Craig"], P: ["", ""], V: [5, 3] },
  { CAT: "Local", C: "City of San José Council, District 5", K: "86", VF: 1, TP: 22, PR: 0, CH: ["A", "B"], P: ["", ""], V: [0, 0] },
];
const race = (id: number, province: string, election_name: string, election_date = NOV_3) => ({ id, type: "Local", country: "US", province, election_name, election_type: "Local", election_date, percent_reporting: 10, candidates: [{ name: "A", votes: 3 }, { name: "B", votes: 1 }] });
const SEARCHES: Record<string, unknown[]> = {
  Greenville: [race(1, "SC", "Greenville City Council District 2"), race(2, "NC", "Greenville Mayor"), race(3, "SC", "School Board 22 Greenville County"), race(4, "SC", "Greenville County Council", "2025-11-04T05:00:00.000Z"), race(6, "SC", "Greenwood Mayor")],
  "Greenville County": [race(3, "SC", "School Board 22 Greenville County"), race(5, "SC", "Greenville County Soil and Water Commissioner")],
  // civicAPI's search finds school boards only when asked for them by name.
  "Greenville school board": [race(7, "SC", "School Board 20 Greenville County")],
};

/** Answers Santa Clara County's feed and civicAPI's searches, keeping every URL asked for. */
function sources() {
  return vi.fn(async (url: string | URL) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith("/current_ver.txt")) return new Response("382435");
    if (u.pathname.endsWith("/summary.json")) return Response.json(clarity);
    if (u.pathname.endsWith("/electionsettings.json")) return Response.json({ websiteupdatedat: "11/3/2026 9:15:02 PM PST" });
    if (u.hostname === "civicapi.org") return Response.json({ races: SEARCHES[u.searchParams.get("query") ?? ""] ?? [] });
    return new Response("not found", { status: 404 });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetCivicMemo();
  resetCountyMemo();
});

describe("localRaces", () => {
  it("reads a Santa Clara County address's races from the county, without asking civicAPI", async () => {
    const fetch = sources();
    vi.stubGlobal("fetch", fetch);
    const local = await localRaces(paloAlto, AFTER_POLLS);
    expect(local).toMatchObject({ area: "Palo Alto, Santa Clara County, California", source: "county", stale: false, nearby: [] });
    expect(local.yours.map((r) => [r.id - COUNTY_ID_BASE, r.total])).toEqual([[42, 8]]);
    expect(fetch.mock.calls.some(([url]) => String(url).includes("civicapi.org"))).toBe(false);
  });

  it("elsewhere, lists civicAPI's Nov 3 races in the address's state naming its city or county, school boards included, once each", async () => {
    vi.stubGlobal("fetch", sources());
    const local = await localRaces(greenville, AFTER_POLLS);
    expect(local).toMatchObject({ area: "Greenville, Greenville County, South Carolina", source: "civicAPI", yours: [], stale: false });
    expect(local.nearby.map((r) => r.id)).toEqual([1, 3, 5, 7]);
    expect(local.nearby[0]).toMatchObject({ total: 4, reporting: 10 });
  });

  it("keeps the races it has when one search fails, marked stale, and fails when there's nothing to show", async () => {
    vi.stubGlobal("fetch", sources());
    await localRaces(greenville, AFTER_POLLS);
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    const later = await localRaces(greenville, AFTER_POLLS + 60_000);
    expect(later.stale).toBe(true);
    expect(later.nearby.map((r) => r.id)).toEqual([1, 3, 5, 7]);
    resetCivicMemo();
    await expect(localRaces(greenville, AFTER_POLLS + 120_000)).rejects.toThrow();
  });

  it("has nothing for a place outside the US states", async () => {
    vi.stubGlobal("fetch", sources());
    expect(await localRaces({ ...base, state: "Puerto Rico", place: "San Juan zona urbana" }, AFTER_POLLS)).toMatchObject({ yours: [], nearby: [] });
  });
});
