import { describe, expect, it } from "vitest";
import { countyLeads, countySwings, swingBases, swingSides, swingSummary } from "../lib/midterms/countyShift";
import { withPast } from "../lib/midterms/pastMargins";
import type { CountyResult } from "../lib/midterms/races";

const county = (fips: string | null, votes: [number, number], baseline2024: number | null): CountyResult => ({
  fips,
  name: `County ${fips}`,
  reporting: 50,
  total: votes[0] + votes[1],
  candidates: [
    { name: "Scott Colom", party: "Democratic", votes: votes[0], pct: 0 },
    { name: "Cindy Hyde-Smith", party: "Republican", votes: votes[1], pct: 0 },
  ],
  baseline2024,
  pres2024: null,
});
const cands = [
  { name: "Scott Colom", party: "Democratic", votes: 0 },
  { name: "Cindy Hyde-Smith", party: "Republican", votes: 0 },
];

describe("countyLeads", () => {
  it("gives each county's leader and raw vote lead, skipping ties, empty counties and unmapped ones", () => {
    const leads = countyLeads([county("28049", [176_249, 129_386], 50), county("28001", [10, 10], 0), county("28003", [0, 0], 0), county(null, [5, 1], 0)]);
    expect(leads).toEqual([{ fips: "28049", leader: expect.objectContaining({ name: "Scott Colom" }), votes: 46_863 }]);
  });
});

describe("swingSides", () => {
  it("pairs the Democrat against the Republican", () => {
    expect(swingSides({ candidates: cands as never })).toMatchObject({ left: { name: "Scott Colom" }, right: { name: "Cindy Hyde-Smith" } });
  });
  it("uses the strongest other candidate when there's no Democrat", () => {
    const ne = [
      { name: "Deb Fischer", party: "Republican", votes: 10 },
      { name: "Write-in", party: "", votes: 1 },
      { name: "Dan Osborn", party: "Independent", votes: 9 },
    ];
    expect(swingSides({ candidates: ne as never })).toMatchObject({ left: { name: "Dan Osborn" }, right: { name: "Deb Fischer" } });
  });
  it("has no sides without a Republican", () => {
    expect(swingSides({ candidates: [cands[0]] as never })).toBeNull();
  });
});

describe("countySwings and swingSummary", () => {
  it("measures each county against its 2024 presidential margin and weights the total by votes", () => {
    // 60-40 Colom against Harris +10: 10 points toward the Democrat. 30-70 against Trump +50: 10 points toward the Democrat too.
    const race = { candidates: cands as never, counties: [county("1", [600, 400], 10), county("2", [300, 700], -50), county("3", [0, 0], 0), county("4", [5, 5], null)] };
    const swings = countySwings(race);
    expect(swings.map((s) => [s.fips, Math.round(s.shift * 10) / 10])).toEqual([
      ["1", 10],
      ["2", 10],
    ]);
    expect(swingSummary(swings)).toEqual({ shift: 10, flipped: 0, counties: 2 });
  });
  it("counts a county whose leader differs from 2024's as flipped", () => {
    const swings = countySwings({ candidates: cands as never, counties: [county("1", [550, 450], -4), county("2", [400, 600], -30)] });
    expect(swingSummary(swings)).toMatchObject({ flipped: 1, counties: 2 });
  });
  it("has no summary with nothing counted", () => {
    expect(swingSummary([])).toBeNull();
  });
});

describe("swing from other past elections", () => {
  it("measures against the picked election's margin and lists only the elections the counties have", () => {
    const withPast = (c: CountyResult, past: Record<string, number>): CountyResult => ({ ...c, past });
    // 60-40 Colom: D+20. Against a 2024 Senate margin of R+10 that's 30 points toward the Democrat.
    const race = { candidates: cands as never, counties: [withPast(county("1", [600, 400], 10), { "2024-senate": -10 }), county("2", [300, 700], -50)] };
    expect(countySwings(race, "2024-senate").map((s) => [s.fips, Math.round(s.shift * 10) / 10])).toEqual([["1", 30]]);
    expect(swingBases(race)).toEqual(["2024-president", "2024-senate"]);
  });
});

describe("withPast", () => {
  it("attaches each county's past margins on the server, and leaves Alaska and unmapped rows alone", () => {
    const race = { state: "MS", counties: [county("28049", [1, 1], 50), county(null, [1, 1], null)] };
    const out = withPast(race);
    expect(out.counties[0].past).toMatchObject({ "2020-president": expect.any(Number), "2024-senate": expect.any(Number) });
    expect(out.counties[1].past).toBeUndefined();
    expect(withPast({ state: "AK", counties: [county("02020", [1, 1], null)] }).counties[0].past).toBeUndefined();
  });
});
