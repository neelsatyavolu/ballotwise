import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOtherRace, resetCivicMemo, searchRaces, searchResults } from "../lib/midterms/civic";
import { FIRST_POLLS_OPEN, summarizeOther } from "../lib/midterms/races";

const AFTER_POLLS = FIRST_POLLS_OPEN + 3_600_000;
const BASELINE = { "05007": [1, 2, 3], "05143": [3, 2, 6] } as const;

const mayor = {
  id: 161607,
  type: "Mayor",
  country: "US",
  province: "AR",
  election_name: "Mayor Elm Springs (Benton & Washington Counties)",
  election_type: "Local",
  election_date: "2026-11-03T05:00:00.000Z",
  percent_reporting: 40,
  candidates: [
    { name: "Mark Farmer", party: "Nonpartisan", color: "#9A36FF", votes: 120 },
    { name: "Ira Coker", party: "Nonpartisan", color: "url(javascript:alert(1))", votes: 80 },
  ],
  region_results: {
    a: { name: "Benton", fips: "05007", percent_reporting: 50, candidates: [{ name: "Mark Farmer", votes: 100 }, { name: "Ira Coker", votes: 50 }] },
    b: { name: "Washington", fips: "05143", percent_reporting: 30, candidates: [{ name: "Mark Farmer", votes: 20 }, { name: "Ira Coker", votes: 30 }] },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  resetCivicMemo();
});

describe("searchResults", () => {
  it("keeps US races from 2026 on, Nov 3 first, and labels local and statewide ones", () => {
    const found = searchResults({
      races: [
        { id: 1, type: "Mayor", country: "US", province: "CA", election_name: "Los Angeles Mayor Open Primary", election_date: "2026-06-02T07:00:00Z", election_type: "Local" },
        { id: 2, type: "Mayor", country: "US", province: "AR", election_name: "Mayor  Elm Springs", election_date: "2026-11-03T05:00:00Z", election_type: "Local" },
        { id: 3, type: "Mayor", country: "CA", province: "ON", election_name: "Toronto Mayor", election_date: "2026-10-26T04:00:00Z", election_type: "Local" },
        { id: 4, type: "Mayor", country: "US", province: "NJ", election_name: "Old Mayor", election_date: "2025-11-04T05:00:00Z", election_type: "Local" },
        { id: 5, type: "Referendum", country: "US", province: "NJ", election_name: "Question 1", election_date: "2026-11-03T05:00:00Z", election_type: "Statewide" },
      ],
    });
    expect(found.map((r) => r.id)).toEqual([2, 5, 1]);
    expect(found[0]).toEqual({ id: 2, title: "Mayor Elm Springs", state: "AR", type: "Mayor", date: "2026-11-03", kind: "local" });
    expect(found[1].kind).toBe("statewide");
  });

  it("returns nothing for an answer it can't read", () => {
    expect(searchResults({ races: "nope" })).toEqual([]);
    expect(searchResults(null)).toEqual([]);
  });

  it("caches a query, so repeat searches don't reach civicAPI", async () => {
    const fetch = vi.fn(async () => Response.json({ races: [{ id: 2, type: "Mayor", country: "US", province: "AR", election_name: "Mayor", election_date: "2026-11-03T05:00:00Z" }] }));
    vi.stubGlobal("fetch", fetch);
    await searchRaces("Mayor", 0);
    await searchRaces("mayor", 1000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("summarizeOther", () => {
  it("carries a local contest as a measure with its kind, keeping only plain hex colors", () => {
    const r = summarizeOther(mayor)!;
    expect(r).toMatchObject({ id: 161607, office: "measure", state: "AR", rating: null, local: { kind: "candidates", type: "Mayor", date: "2026-11-03" } });
    expect(r.candidates.map((c) => c.color)).toEqual(["#9A36FF", undefined]);
  });

  it("tells a yes/no question apart and leaves races outside the US out", () => {
    const q = summarizeOther({ ...mayor, type: "Referendum", candidates: [{ name: "Yes" }, { name: "No" }] })!;
    expect(q.local?.kind).toBe("question");
    expect(summarizeOther({ ...mayor, country: "CA" })).toBeNull();
    expect(summarizeOther({ id: 1 })).toBeNull();
  });
});

describe("fetchOtherRace", () => {
  it("returns the race with county results and civicAPI's colors on its counties", async () => {
    vi.stubGlobal("fetch", async () => Response.json(mayor));
    const found = (await fetchOtherRace(161607, AFTER_POLLS, BASELINE))!;
    expect(found.race.total).toBe(200);
    expect(found.race.counties.map((c) => c.fips)).toEqual(["05007", "05143"]);
    expect(found.race.counties[0].candidates[0]).toMatchObject({ name: "Mark Farmer", color: "#9A36FF" });
  });

  it("shows no numbers for a Nov 3 race before polls open, as with tracked races", async () => {
    vi.stubGlobal("fetch", async () => Response.json(mayor));
    const found = (await fetchOtherRace(161607, FIRST_POLLS_OPEN - 1, BASELINE))!;
    expect(found.race.total).toBe(0);
    expect(found.race.counties.every((c) => c.total === 0)).toBe(true);
  });

  it("remembers an id civicAPI doesn't have, without retrying it", async () => {
    const fetch = vi.fn(async () => Response.json({ error: "race not found!" }, { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchOtherRace(999, AFTER_POLLS, BASELINE)).toBeNull();
    expect(await fetchOtherRace(999, AFTER_POLLS + 60_000, BASELINE)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("serves the last good copy, marked stale, when civicAPI fails", async () => {
    vi.stubGlobal("fetch", async () => Response.json(mayor));
    await fetchOtherRace(161607, AFTER_POLLS, BASELINE);
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    const found = (await fetchOtherRace(161607, AFTER_POLLS + 60_000, BASELINE))!;
    expect(found.stale).toBe(true);
    expect(found.race.total).toBe(200);
  });
});
