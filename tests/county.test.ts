import { afterEach, describe, expect, it, vi } from "vitest";
import { COUNTY_ID_BASE, countyRacesFor, fetchCountyRace, isCountyRace, mergeFound, resetCountyMemo, searchCounty } from "../lib/midterms/county";
import type { FoundRace } from "../lib/midterms/civic";
import { FIRST_POLLS_OPEN } from "../lib/midterms/races";

const AFTER_POLLS = FIRST_POLLS_OPEN + 3_600_000;

// Contests as Santa Clara County's Clarity feed lists them for Nov 3, 2026, trimmed to the fields that matter.
const contest = (K: string, CAT: string, C: string, VF: number, CH: string[], V: number[], PR = 0, TP = 22) => ({ CATKEY: "C_1", CAT, C, K, VF, TP, PR, CH, P: CH.map(() => ""), V, W: CH.map(() => 0) });
const SUMMARY = [
  contest("1", "State and Federal", "Governor", 1, ["Steve Hilton", "Xavier Becerra"], [10, 20], 300, 708),
  contest("42", "School", "Palo Alto Unified SD", 2, ["Linda Henigin", "Avery Wang", "John Craig", "Write-in"], [300, 500, 200, 0], 11),
  contest("85", "Local", "City of Palo Alto Council", 3, ["Brian Hamachek", "Yu ''Yudy'' Deng", "Write-in"], [40, 60, 5], 11),
  contest("86", "Local", "City of San José Council, District 5", 1, ["A", "B"], [1, 2]),
  contest("49", "School", "Fremont Union HSD, TA 4", 1, ["C", "D"], [1, 2]),
  contest("125", "Measures", "Measure J - City of Palo Alto, Transactions and Use Tax", 0, ["YES", "NO"], [70, 30], 11),
  contest("75", "Local", "City of Los Altos Council, D2", 1, ["E", "F"], [1, 2]),
  contest("77", "Local", "Town of Los Altos Hills Council", 2, ["G", "H"], [1, 2]),
  contest("84", "Local", "City of Mountain View Council", 3, ["I", "J"], [1, 2]),
  contest("61", "School", "Mountain View Whisman SD", 2, ["K", "L"], [1, 2]),
  contest("51", "School", "Mountain View-Los Altos Union HSD, TA 3", 1, ["M", "N"], [1, 2]),
  contest("130", "Measures", "Measure M - Gilroy Unified School District, School Bond", 0, ["YES", "NO"], [1, 2]),
];
const SETTINGS = { websiteupdatedat: "11/3/2026 9:15:02 PM PST" };

/** A fetch that answers the feed's three files, counting each request. */
function feed(summary: unknown = SUMMARY) {
  return vi.fn(async (url: string | URL) => {
    const path = String(url);
    if (path.endsWith("/current_ver.txt")) return new Response("382435");
    if (path.endsWith("/382435/json/en/summary.json")) return Response.json(summary);
    if (path.endsWith("/382435/json/en/electionsettings.json")) return Response.json(SETTINGS);
    return new Response("not found", { status: 404 });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetCountyMemo();
});

describe("searchCounty", () => {
  it("finds the Palo Alto school board from how people say it, and nothing else", async () => {
    vi.stubGlobal("fetch", feed());
    const found = await searchCounty("palo alto school board", AFTER_POLLS);
    expect(found).toEqual([{ id: COUNTY_ID_BASE + 42, title: "Palo Alto Unified School District, 2 seats", state: "CA", type: "School Board", date: "2026-11-03", kind: "local" }]);
  });

  it("matches a place's races, a district's acronym, and San José without the accent", async () => {
    vi.stubGlobal("fetch", feed());
    expect((await searchCounty("Palo Alto", AFTER_POLLS)).map((r) => r.id - COUNTY_ID_BASE)).toEqual([42, 85, 125]);
    expect((await searchCounty("PAUSD", AFTER_POLLS)).map((r) => r.id - COUNTY_ID_BASE)).toEqual([42]);
    expect((await searchCounty("san jose city council", AFTER_POLLS)).map((r) => r.title)).toEqual(["City of San José Council, District 5"]);
    expect((await searchCounty("fremont union high school district", AFTER_POLLS)).map((r) => r.title)).toEqual(["Fremont Union High School District, Trustee Area 4"]);
  });

  it("labels measures so the Search tab files them under ballot measures, and leaves state races to civicAPI", async () => {
    vi.stubGlobal("fetch", feed());
    expect((await searchCounty("measure j", AFTER_POLLS))[0]).toMatchObject({ type: "Ballot Measure", kind: "local" });
    expect(await searchCounty("governor", AFTER_POLLS)).toEqual([]);
  });

  it("reuses the feed for a while, so typing doesn't refetch it", async () => {
    const fetch = feed();
    vi.stubGlobal("fetch", fetch);
    await searchCounty("palo alto", AFTER_POLLS);
    await searchCounty("pausd", AFTER_POLLS + 1000);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe("countyRacesFor", () => {
  const ids = (races: { id: number }[]) => races.map((r) => r.id - COUNTY_ID_BASE);

  it("puts a Palo Alto address's council, school board and city measure on its ballot", async () => {
    vi.stubGlobal("fetch", feed());
    const { yours, nearby } = await countyRacesFor({ city: "Palo Alto city", schools: ["Palo Alto Unified School District"] }, AFTER_POLLS);
    expect(ids(yours)).toEqual([42, 85, 125]);
    expect(nearby).toEqual([]);
    expect(yours[0]).toMatchObject({ title: "Palo Alto Unified School District, 2 seats", total: 1000, source: { name: "Santa Clara County" } });
    expect(yours[2].about?.text).toBe("City of Palo Alto, Transactions and Use Tax");
  });

  it("matches the Census's elementary and high school district names, leaving a trustee area as depending on where you live", async () => {
    vi.stubGlobal("fetch", feed());
    const { yours, nearby } = await countyRacesFor({ city: "Mountain View city", schools: ["Mountain View Whisman Elementary School District", "Mountain View-Los Altos Union School District"] }, AFTER_POLLS);
    expect(ids(yours)).toEqual([84, 61]);
    expect(ids(nearby)).toEqual([51]);
  });

  it("tells council districts, neighboring towns and school measures apart", async () => {
    vi.stubGlobal("fetch", feed());
    const sj = await countyRacesFor({ city: "San Jose city", schools: ["San Jose Unified School District"] }, AFTER_POLLS);
    expect([ids(sj.yours), ids(sj.nearby)]).toEqual([[], [86]]);
    const hills = await countyRacesFor({ city: "Los Altos Hills town", schools: [] }, AFTER_POLLS);
    expect([ids(hills.yours), ids(hills.nearby)]).toEqual([[77], []]);
    const gilroy = await countyRacesFor({ city: null, schools: ["Gilroy Unified School District"] }, AFTER_POLLS);
    expect(ids(gilroy.yours)).toEqual([130]);
  });

  it("shows no numbers before polls open", async () => {
    vi.stubGlobal("fetch", feed());
    const { yours } = await countyRacesFor({ city: "Palo Alto city", schools: [] }, FIRST_POLLS_OPEN - 1);
    expect(yours.every((r) => r.total === 0)).toBe(true);
  });
});

describe("mergeFound", () => {
  const county = [{ id: COUNTY_ID_BASE + 42 }] as FoundRace[];
  const civic = [{ id: 7 }] as FoundRace[];
  it("puts county races first when the search names a place, and civicAPI's first when it names only an office", () => {
    expect(mergeFound("palo alto school board", county, civic).map((r) => r.id)).toEqual([COUNTY_ID_BASE + 42, 7]);
    expect(mergeFound("school board", county, civic).map((r) => r.id)).toEqual([7, COUNTY_ID_BASE + 42]);
  });

  it("keeps to 25 results", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: COUNTY_ID_BASE + i }) as FoundRace);
    expect(mergeFound("palo alto", many, civic)).toHaveLength(25);
  });
});

describe("fetchCountyRace", () => {
  it("shows a contest's votes, precincts in, update time and source, dropping an empty write-in line", async () => {
    vi.stubGlobal("fetch", feed());
    const { race, stale } = (await fetchCountyRace(COUNTY_ID_BASE + 42, AFTER_POLLS))!;
    expect(stale).toBe(false);
    expect(race).toMatchObject({ id: COUNTY_ID_BASE + 42, office: "measure", state: "CA", title: "Palo Alto Unified School District, 2 seats", reporting: 50, total: 1000, counties: [], local: { kind: "candidates", type: "School Board", date: "2026-11-03" } });
    expect(race.source).toEqual({ name: "Santa Clara County", url: expect.stringContaining("clarityelections.com/CA/Santa_Clara/127570") });
    expect(race.candidates.map((c) => [c.name, c.votes, c.winner])).toEqual([["Avery Wang", 500, false], ["Linda Henigin", 300, false], ["John Craig", 200, false]]);
    expect(Date.parse(race.updated!)).toBe(Date.parse("2026-11-04T05:15:02Z"));
  });

  it("keeps write-in votes when there are some, and writes nicknames with plain quotes", async () => {
    vi.stubGlobal("fetch", feed());
    const { race } = (await fetchCountyRace(COUNTY_ID_BASE + 85, AFTER_POLLS))!;
    expect(race.candidates.map((c) => c.name)).toEqual(['Yu "Yudy" Deng', "Brian Hamachek", "Write-in"]);
    // Each candidate keeps one color by ballot order, never the parties' blue or red.
    expect(race.candidates.map((c) => c.color)).toEqual(["#f59e0b", "#14b8a6", "#a855f7"]);
  });

  it("reads a measure as a yes/no question", async () => {
    vi.stubGlobal("fetch", feed());
    const { race } = (await fetchCountyRace(COUNTY_ID_BASE + 125, AFTER_POLLS))!;
    expect(race.local?.kind).toBe("question");
    expect(race.candidates.map((c) => c.name)).toEqual(["Yes", "No"]);
    expect(race.about).toEqual({ text: "City of Palo Alto, Transactions and Use Tax", url: null });
  });

  it("shows no numbers before polls open, as with civicAPI's races", async () => {
    vi.stubGlobal("fetch", feed());
    const { race } = (await fetchCountyRace(COUNTY_ID_BASE + 42, FIRST_POLLS_OPEN - 1))!;
    expect(race.total).toBe(0);
    expect(race.reporting).toBe(0);
    expect(race.candidates).toHaveLength(3);
  });

  it("has no race for a contest it doesn't carry or an id outside its range", async () => {
    vi.stubGlobal("fetch", feed());
    expect(await fetchCountyRace(COUNTY_ID_BASE + 1, AFTER_POLLS)).toBeNull();
    expect(await fetchCountyRace(COUNTY_ID_BASE + 999, AFTER_POLLS)).toBeNull();
    expect(isCountyRace(COUNTY_ID_BASE + 42)).toBe(true);
    expect(isCountyRace(173233)).toBe(false);
  });

  it("serves the last good copy, marked stale, when the county's feed fails", async () => {
    vi.stubGlobal("fetch", feed());
    await fetchCountyRace(COUNTY_ID_BASE + 42, AFTER_POLLS);
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    const found = (await fetchCountyRace(COUNTY_ID_BASE + 42, AFTER_POLLS + 60_000))!;
    expect(found.stale).toBe(true);
    expect(found.race.total).toBe(1000);
  });

  it("throws when the feed fails with nothing to fall back on", async () => {
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    await expect(fetchCountyRace(COUNTY_ID_BASE + 42, AFTER_POLLS)).rejects.toThrow();
  });
});
