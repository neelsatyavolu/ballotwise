import { describe, expect, it } from "vitest";
import { countiesForMap } from "../lib/midterms/countyRollup";
import type { CountyResult } from "../lib/midterms/races";

const place = (fips: string | null, name: string, d: number, r: number, reporting = 50): CountyResult => ({
  fips, name, reporting, total: d + r, baseline2024: null, pres2024: null,
  candidates: [{ name: "Dee", party: "Democratic", votes: d, pct: 0 }, { name: "Arr", party: "Republican", votes: r, pct: 0 }],
});

describe("countiesForMap", () => {
  it("rolls New England towns up into their counties, named, with reporting weighted by each town's count", () => {
    // Auburn and Greene are in Androscoggin (23001); Portland in Cumberland (23005). The county row with no code is left out.
    const out = countiesForMap("ME", [place(null, "Androscoggin", 99, 99), place("2300102060", "Auburn", 600, 400, 80), place("2300129255", "Greene", 100, 900, 20), place("2300560545", "Portland", 50, 50)]);
    const andro = out.find((c) => c.fips === "23001")!;
    expect(andro).toMatchObject({ name: "Androscoggin", total: 2000, reporting: 50 });
    expect(andro.candidates).toEqual([
      { name: "Arr", party: "Republican", votes: 1300, pct: 65 },
      { name: "Dee", party: "Democratic", votes: 700, pct: 35 },
    ]);
    expect(out.map((c) => c.fips).sort()).toEqual(["23001", "23005"]);
  });

  it("keeps a county's own row where it has more votes than its towns, and leaves county-coded races alone", () => {
    const own = place("23001", "Androscoggin", 3000, 2000);
    expect(countiesForMap("ME", [own, place("2300102060", "Auburn", 600, 400)])).toEqual([own]);
    const texas = [place("48201", "Harris", 10, 5)];
    expect(countiesForMap("TX", texas)).toEqual(texas);
  });
});
