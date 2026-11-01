import { describe, expect, it } from "vitest";
import { raceDetail, type RaceSummary } from "../lib/midterms/races";
import { townCodes } from "../lib/midterms/towns";

const codes = (state: string, names: (string | { name: string; fips: string })[]) => townCodes(state, names.map((n) => (typeof n === "string" ? { name: n } : n)));

describe("townCodes", () => {
  it("leaves a state that reports by county alone", () => {
    expect(codes("GA", ["Fulton"])).toBeNull();
  });

  it("tells a city from the town of the same name, and writes Saint as the Census does", () => {
    expect(codes("VT", ["Barre City", "Barre Town", "Saint Albans City", "Saint Albans Town"])).toEqual(["5002303175", "5002303250", "5001161675", "5001161750"]);
  });

  it("reads a township sharing its county's name as the town, and skips the county's own subtotal", () => {
    expect(codes("MA", ["Barnstable Township", { name: "Barnstable", fips: "25001" }, "Agawam"])).toEqual(["2500103690", null, "2501300840"]);
    expect(codes("ME", [{ name: "Cumberland", fips: "23005" }, "Cumberland"])).toEqual([null, "2300515430"]);
  });

  it("prefers the town over a plantation of the same name, unless the plantation is named", () => {
    expect(codes("ME", ["Rangeley", "Rangeley Plantation"])).toEqual(["2300761840", "2300761875"]);
  });

  it("files a city's wards under the city", () => {
    expect(codes("NH", ["Manchester Ward 1", "Manchester Ward 2"])).toEqual(["3301145140", "3301145140"]);
  });

  it("maps neither of two places that claim one town, and nothing that isn't a town", () => {
    expect(codes("ME", ["Lincoln", "Lincoln", "UOCAVA"])).toEqual([null, null, null]);
  });
});

describe("raceDetail in a town state", () => {
  it("sums a city's wards into one town", () => {
    const summary: RaceSummary = { id: 1, office: "governor", state: "NH", district: null, title: "New Hampshire Governor", reporting: 0, total: 0, candidates: [], rating: null };
    const input = {
      election_name: "New Hampshire Governor",
      election_date: "2026-11-03T05:00:00.000Z",
      candidates: [{ name: "A", votes: 30 }, { name: "B", votes: 20 }],
      region_results: {
        w1: { name: "Manchester Ward 1", candidates: [{ name: "A", votes: 10 }, { name: "B", votes: 5 }] },
        w2: { name: "Manchester Ward 2", candidates: [{ name: "A", votes: 20 }, { name: "B", votes: 15 }] },
      },
    };
    const { counties } = raceDetail(summary, input, {});
    expect(counties).toHaveLength(1);
    expect(counties[0]).toMatchObject({ fips: "3301145140", name: "Manchester city", total: 50 });
  });
});
