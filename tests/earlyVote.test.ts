import { describe, expect, it } from "vitest";
import { breakdown, countiesOf, earlyFeed, leanOf, nationOf, partyOf, priorDate, shareOf2024, type EarlyCounty, type EarlyFeed } from "../lib/midterms/earlyVote";

const tally = (t: Record<string, number>) => Object.fromEntries(Object.entries(t).map(([k, votes]) => [k, { votes, color: "#999" }]));
const feed = (regions: Record<string, Record<string, number>>, asOf = "2026-10-30"): EarlyFeed =>
  earlyFeed.parse({ snapshot_date: asOf, regions: Object.fromEntries(Object.entries(regions).map(([k, v]) => [k, tally(v)])), statewide_total: {} });
type Regions = Record<string, Record<string, number>>;
const feeds = (returned: Regions, inperson: Regions = {}, requested: Regions = {}) => ({ returned: feed(returned), inperson: feed(inperson), requested: feed(requested) });

describe("partyOf", () => {
  it("splits registration into Democrats, Republicans and everyone else", () => {
    expect(partyOf([tally({ Democratic: 50, Republican: 30, "No Party Affiliation": 15, Libertarian: 5 })])).toEqual({ dem: 50, rep: 30, other: 20 });
  });

  it("adds mail and in-person ballots together", () => {
    expect(partyOf([tally({ Democratic: 10, Republican: 5 }), tally({ Democratic: 1, Republican: 4, Other: 2 })])).toEqual({ dem: 11, rep: 9, other: 2 });
  });

  it("has no party split when the state doesn't record one for most ballots", () => {
    expect(partyOf([tally({ Unspecified: 1000 })])).toBeNull();
    expect(partyOf([tally({ Democratic: 40, Republican: 40, Unspecified: 20 })])).toBeNull();
    expect(partyOf([tally({})])).toBeNull();
  });
});

describe("countiesOf", () => {
  const VA = { "51059": "Fairfax", "51600": "Fairfax", "51036": "Charles City", "51159": "Richmond", "51760": "Richmond" };

  it("tells Virginia's independent cities from the counties of the same name", () => {
    const { counties } = countiesOf(feeds({ Fairfax: { Unspecified: 10 }, "Fairfax City": { Unspecified: 2 }, "Charles City": { Unspecified: 3 }, "Richmond City": { Unspecified: 7 } }), VA);
    const byFips = Object.fromEntries(counties.map((c) => [c.fips, c.returned]));
    expect(byFips).toEqual({ "51059": 10, "51600": 2, "51036": 3, "51760": 7 });
  });

  it("matches names whatever their suffix or punctuation", () => {
    const { counties } = countiesOf(feeds({ "Baltimore City": { Unspecified: 9 }, "Baltimore County": { Unspecified: 4 }, "St Marys": { Unspecified: 1 } }), { "24510": "Baltimore", "24005": "Baltimore", "24037": "St. Mary's" });
    expect(Object.fromEntries(counties.map((c) => [c.fips, c.returned]))).toEqual({ "24510": 9, "24005": 4, "24037": 1 });
  });

  it("adds a city's own election board into its county", () => {
    const { counties } = countiesOf(feeds({ Cook: { Unspecified: 100 }, "City of Chicago": { Unspecified: 250 } }, { "City of Chicago": { Unspecified: 5 } }), { "17031": "Cook" });
    expect(counties).toEqual([expect.objectContaining({ fips: "17031", name: "Cook", returned: 350, inperson: 5, cast: 355 })]);
  });

  it("keeps places that aren't counties, and says when a state reports by town", () => {
    const towns = countiesOf(feeds({ Andover: { Unspecified: 3 }, Avon: { Unspecified: 8 } }), { "09003": "Hartford" });
    expect(towns.byTown).toBe(true);
    expect(towns.counties.map((c) => [c.name, c.fips])).toEqual([["Avon", null], ["Andover", null]]);
  });

  it("doesn't take a town for the county it shares a name with", () => {
    const towns = countiesOf(feeds({ Hartford: { Unspecified: 9 }, Andover: { Unspecified: 3 }, Avon: { Unspecified: 8 } }), { "09003": "Hartford" });
    expect(towns.byTown).toBe(true);
    expect(towns.counties.map((c) => [c.name, c.fips, c.base2024])).toEqual([["Hartford", null, null], ["Avon", null, null], ["Andover", null, null]]);
  });

  it("joins requests, mail returns and in-person votes, largest first", () => {
    const { counties, byTown } = countiesOf(feeds({ Kent: { Democratic: 5, Republican: 5 } }, { Kent: { Democratic: 10, Republican: 20 }, Sussex: { Republican: 50 } }, { Kent: { Democratic: 30 } }), { "10001": "Kent", "10005": "Sussex" });
    expect(byTown).toBe(false);
    expect(counties.map((c) => [c.name, c.requested, c.returned, c.inperson, c.cast])).toEqual([["Sussex", 0, 0, 50, 50], ["Kent", 30, 10, 30, 40]]);
    expect(counties[1].party).toEqual({ dem: 15, rep: 25, other: 0 });
  });
});

describe("nationOf", () => {
  it("lists each reporting state with its counts, largest first", () => {
    const nation = nationOf(feeds({ NC: { Democratic: 7 }, GA: { Unspecified: 60 } }, { GA: { Unspecified: 40 }, NC: { Democratic: 20, Republican: 20 } }, { NC: { Democratic: 3 } }));
    expect(nation.asOf).toBe("2026-10-30");
    expect(nation.states.map((s) => [s.state, s.requested, s.returned, s.inperson, s.cast, s.party])).toEqual([
      ["GA", 0, 60, 40, 100, null],
      ["NC", 3, 7, 40, 47, { dem: 27, rep: 20, other: 0 }],
    ]);
    expect(nation.states[0].base2024).toBeGreaterThan(5_000_000);
  });

  it("ignores anything that isn't a state", () => {
    expect(nationOf(feeds({ ZZ: { Unspecified: 1 } })).states).toEqual([]);
  });
});

describe("priorDate", () => {
  it("lands the same number of days before the 2024 election", () => {
    expect(priorDate("2026-10-30")).toBe("2024-11-01");
    expect(priorDate("2026-11-03")).toBe("2024-11-05");
    expect(priorDate("2026-10-03")).toBe("2024-10-05");
  });
});

describe("breakdown", () => {
  it("tidies civicAPI's labels and keeps age groups in order", () => {
    expect(breakdown("age", [{ "Age 18 - 25": 5, "Age Over 65": 9 }, { "Age 18 - 25": 1 }])).toEqual([{ label: "18–25", votes: 6 }, { label: "Over 65", votes: 9 }]);
  });

  it("puts the largest groups first and drops a breakdown with nothing in it", () => {
    expect(breakdown("gender", [{ FEMALE: 3, MALE: 7, UNDESIGNATED: 0 }])).toEqual([{ label: "Male", votes: 7 }, { label: "Female", votes: 3 }]);
    expect(breakdown("race", [{ White: 0, Black: 0 }])).toBeNull();
  });
});

describe("shareOf2024", () => {
  it("is the ballots cast so far over the 2024 presidential vote", () => {
    expect(shareOf2024(250, 1000)).toBe(25);
    expect(shareOf2024(250, null)).toBeNull();
    expect(shareOf2024(250, 0)).toBeNull();
  });
});

describe("leanOf", () => {
  const county = (fips: string | null, cast: number) => ({ name: fips ?? "Town", fips, cast }) as EarlyCounty;
  // Delaware's 2024 presidential vote: Kent D+2.0, New Castle D+32.6, Sussex R+11.0; the state D+14.7.
  const margin = (d: number, r: number, total: number) => ((d - r) / total) * 100;

  it("weights each county's 2024 margin by its early ballots", () => {
    const lean = leanOf("DE", [county("10001", 100), county("10003", 300), county("10005", 100)]);
    const expected = (100 * margin(44222, 42458, 88141) + 300 * margin(180700, 90868, 275917) + 100 * margin(64836, 81025, 147639)) / 500;
    expect(lean?.margin).toBeCloseTo(expected, 6);
    expect(lean?.state2024).toBeCloseTo(margin(44222 + 180700 + 64836, 42458 + 90868 + 81025, 88141 + 275917 + 147639), 6);
    expect(lean?.coverage).toBe(1);
  });

  it("leans toward where the ballots come from", () => {
    expect(leanOf("DE", [county("10005", 900), county("10003", 100)])!.margin).toBeLessThan(0);
    expect(leanOf("DE", [county("10005", 100), county("10003", 900)])!.margin).toBeGreaterThan(20);
  });

  it("makes no estimate when most ballots can't be placed in a county", () => {
    expect(leanOf("DE", [county("10001", 100), county(null, 900)])).toBeNull();
    expect(leanOf("DE", [])).toBeNull();
    expect(leanOf("DE", [county("10001", 0)])).toBeNull();
  });
});
