import { describe, expect, it } from "vitest";
import { countyLabel, lastName, marginOf, nationRows, rowsFor } from "../lib/midterms/pastResults";

const DEM = { name: "Kamala Harris", party: "DEM" };
const GOP = { name: "Donald J. Trump", party: "GOP" };

describe("rowsFor", () => {
  it("lists the state's candidates by votes, with everyone else as Others", () => {
    const rows = rowsFor({ d: 778, r: 226, a: 0, t: 1037 }, { d: DEM, r: GOP });
    expect(rows.map((r) => [r.name, r.votes, r.slot])).toEqual([
      ["Kamala Harris", 778, "d"],
      ["Donald J. Trump", 226, "r"],
      ["Others", 33, null],
    ]);
  });

  it("includes the third candidate and leaves out an empty Others row", () => {
    const rows = rowsFor({ d: 10, r: 50, a: 40, t: 100 }, { d: DEM, r: GOP, a: { name: "Evan McMullin", party: "IND" } });
    expect(rows.map((r) => r.name)).toEqual(["Donald J. Trump", "Evan McMullin", "Kamala Harris"]);
  });

  it("skips a slot the state has no candidate for, such as California's two-Democrat Senate race", () => {
    const rows = rowsFor({ d: 60, r: 0, a: 40, t: 100 }, { d: { name: "Dianne Feinstein", party: "DEM" }, a: { name: "Kevin de León", party: "DEM" } });
    expect(rows.map((r) => r.name)).toEqual(["Dianne Feinstein", "Kevin de León"]);
  });
});

describe("marginOf", () => {
  it("gives the leader and their lead over the runner-up as a share of all votes", () => {
    const m = marginOf(rowsFor({ d: 151628, r: 165924, a: 0, t: 326000 }, { d: DEM, r: GOP }));
    expect(m?.leader.name).toBe("Donald J. Trump");
    expect(m?.pct).toBeCloseTo(4.385, 2);
  });

  it("has no margin without votes, or when the leaders tie", () => {
    expect(marginOf(rowsFor({ d: 0, r: 0, a: 0, t: 0 }, { d: DEM, r: GOP }))).toBeNull();
    expect(marginOf(rowsFor({ d: 5, r: 5, a: 0, t: 10 }, { d: DEM, r: GOP }))).toBeNull();
  });
});

describe("nationRows", () => {
  const states = {
    PA: { slots: { d: DEM, r: GOP }, cands: [{ ...DEM, votes: 10 }, { ...GOP, votes: 12 }, { name: "Others", party: "", votes: 1 }], total: 23 },
    UT: { slots: { d: DEM, r: GOP }, cands: [{ ...GOP, votes: 5 }, { ...DEM, votes: 3 }, { name: "Evan McMullin", party: "IND", votes: 4 }], total: 12 },
  };

  it("adds each presidential candidate up across the states", () => {
    expect(nationRows(states, true).map((r) => [r.name, r.votes])).toEqual([
      ["Donald J. Trump", 17],
      ["Kamala Harris", 13],
      ["Evan McMullin", 4],
      ["Others", 1],
    ]);
  });

  it("keeps one row for a candidate on different party lines in different states", () => {
    const lines = {
      NM: { slots: {}, cands: [{ name: "Gary Johnson", party: "LIB", votes: 7 }], total: 7 },
      MN: { slots: {}, cands: [{ name: "Gary Johnson", party: "IND", votes: 3 }], total: 3 },
      CO: { slots: {}, cands: [{ name: "Gary Johnson", party: "IND", votes: 3 }], total: 3 },
    };
    expect(nationRows(lines, true).map((r) => [r.name, r.party, r.votes])).toEqual([["Gary Johnson", "LIB", 13]]);
  });

  it("adds up parties instead when every state has its own race", () => {
    expect(nationRows(states, false).map((r) => [r.name, r.votes])).toEqual([
      ["Republicans", 17],
      ["Democrats", 13],
      ["Others", 5],
    ]);
  });
});

describe("lastName", () => {
  it("keeps a lowercase particle with the surname", () => {
    expect(lastName("Donald J. Trump")).toBe("Trump");
    expect(lastName("Kevin de León")).toBe("de León");
    expect(lastName("Others")).toBe("Others");
  });
});

describe("countyLabel", () => {
  it("names counties, parishes and independent cities", () => {
    expect(countyLabel("CA", "06019", "Fresno")).toBe("Fresno County");
    expect(countyLabel("LA", "22071", "Orleans")).toBe("Orleans Parish");
    expect(countyLabel("VA", "51760", "Richmond")).toBe("Richmond City");
    expect(countyLabel("VA", "51159", "Richmond")).toBe("Richmond County");
    expect(countyLabel("MO", "29510", "St. Louis")).toBe("St. Louis City");
    expect(countyLabel("NV", "32510", "Carson City")).toBe("Carson City");
    expect(countyLabel("AK", "02020", "Anchorage")).toBe("Anchorage");
  });
});
