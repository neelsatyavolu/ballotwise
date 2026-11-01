import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRace, resetCivicMemo } from "../lib/midterms/civic";
import { stateCloses } from "../lib/midterms/polls";
import { LAST_CLOSE, resultsHidden, summarize } from "../lib/midterms/races";

// civicAPI rehearses election night with test counts and test calls (from Oct 25, 2026), marking each race's answer
// test_data: true. None of it may reach a page, a call list or a push alert.

const SIX_AM_ET = Date.parse("2026-11-03T11:00:00Z");
const GA_CLOSE = stateCloses("GA")!;

const georgia = (extra: object = {}) => ({
  id: 87001,
  type: "US Senate",
  province: "GA",
  election_name: "Georgia US Senate",
  election_type: "General",
  election_date: "2026-11-03T05:00:00.000Z",
  percent_reporting: 100,
  candidates: [
    { name: "Jon Ossoff", party: "Democratic", votes: 1_200_000, winner: true },
    { name: "Mike Collins", party: "Republican", votes: 1_100_000, winner: false },
  ],
  region_results: { a: { name: "Fulton", fips: "13121", percent_reporting: 100, candidates: [{ name: "Jon Ossoff", votes: 300_000 }, { name: "Mike Collins", votes: 100_000 }] } },
  ...extra,
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetCivicMemo();
});

describe("resultsHidden", () => {
  it("hides a race until its own state's first polls close, not just until polls open", () => {
    expect(resultsHidden("GA", SIX_AM_ET)).toBe(true);
    expect(resultsHidden("GA", GA_CLOSE - 1)).toBe(true);
    expect(resultsHidden("GA", GA_CLOSE)).toBe(false);
    // Kentucky's eastern counties close at 6 p.m.; its western ones an hour later don't hold the first results back.
    expect(resultsHidden("KY", stateCloses("KY")!)).toBe(false);
    expect(resultsHidden("CA", GA_CLOSE)).toBe(true);
  });

  it("waits for the night's last closing in a state the closing table doesn't list", () => {
    expect(resultsHidden("ZZ", LAST_CLOSE - 1)).toBe(true);
    expect(resultsHidden("ZZ", LAST_CLOSE)).toBe(false);
  });

  it("always hides a race civicAPI marks as test data", () => {
    expect(resultsHidden("GA", LAST_CLOSE + 3_600_000, true)).toBe(true);
  });
});

describe("fetchRace", () => {
  const summary = summarize(georgia(), [], SIX_AM_ET)!;

  it("shows no votes, county votes or call for a race marked as test data, even after polls close", async () => {
    vi.stubGlobal("fetch", async () => Response.json(georgia({ test_data: true })));
    const { race } = await fetchRace(summary, GA_CLOSE + 3_600_000, {});
    expect(race.total).toBe(0);
    expect(race.candidates.some((c) => c.winner || c.votes > 0)).toBe(false);
    expect(race.counties.every((c) => c.total === 0)).toBe(true);
  });

  it("shows nothing between 6 a.m. and the state's closing, when civicAPI may still hold its rehearsal numbers", async () => {
    vi.stubGlobal("fetch", async () => Response.json(georgia()));
    const { race } = await fetchRace(summary, GA_CLOSE - 60_000, {});
    expect(race.total).toBe(0);
    expect(race.candidates.some((c) => c.winner)).toBe(false);
  });

  it("shows the count and the call once the state's polls have closed and the data is real", async () => {
    vi.stubGlobal("fetch", async () => Response.json(georgia({ test_data: false })));
    const { race } = await fetchRace(summary, GA_CLOSE + 3_600_000, {});
    expect(race.total).toBe(2_300_000);
    expect(race.candidates.find((c) => c.winner)?.name).toBe("Jon Ossoff");
  });
});

describe("incumbents", () => {
  const house = (district: string, names: string[]) => ({
    type: "House of Representatives",
    province: district.slice(0, 2),
    district,
    election_name: `US House ${district}`,
    election_type: "General",
    election_date: "2026-11-03T05:00:00.000Z",
    candidates: names.map((name) => ({ name, party: "Democratic", votes: 0 })),
  });

  it("marks the seat's holder when civicAPI leaves the flag empty", () => {
    const maine = summarize({ ...georgia(), province: "ME", election_name: "Maine US Senate", candidates: [{ name: "Susan M. Collins", party: "Republican" }, { name: "Graham Platner", party: "Democratic" }] }, [])!;
    expect(maine.candidates.find((c) => c.incumbent)?.name).toBe("Susan M. Collins");
  });

  it("doesn't mark a candidate who only shares the holder's last name", () => {
    const race = summarize(house("IL-04", ["Patty Garcia", "Someone Else"]), [])!;
    expect(race.candidates.some((c) => c.incumbent)).toBe(false);
  });

  it("keeps civicAPI's own flag when it sets one", () => {
    const race = summarize({ ...georgia(), province: "AK", election_name: "Alaska US Senate", candidates: [{ name: "Dan Sullivan", party: "Republican", incumbent: true }, { name: "Daniel J. Jr. Sullivan", party: "Republican" }] }, [])!;
    expect(race.candidates.filter((c) => c.incumbent).map((c) => c.name)).toEqual(["Dan Sullivan"]);
  });
});
