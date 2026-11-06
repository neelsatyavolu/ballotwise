import { describe, expect, it } from "vitest";
import { countyShifts, swingLabel, swingOf, type SwingFile } from "../lib/midterms/pastShift";

describe("swingOf", () => {
  it("is the margin now less the margin then, with both margins", () => {
    expect(swingOf([-1.5, 4.5])).toEqual({ now: -1.5, then: 4.5, shift: -6 });
  });

  it("rounds the move to a tenth, as it's shown", () => {
    expect(swingOf([0.31, -0.42])?.shift).toBe(0.7);
  });

  it("is null for a place with nothing to compare", () => {
    expect(swingOf(undefined)).toBeNull();
  });
});

describe("countyShifts", () => {
  it("gives each county's move by its code", () => {
    const file: SwingFile = { id: "2024-president", year: 2024, base: 2020, us: [-1.5, 4.5], states: {}, counties: { "13149": [-70, -68.5], "13067": [14.93, 14.31] } };
    expect(countyShifts(file)).toEqual({ "13149": -1.5, "13067": 0.62 });
  });
});

describe("swingLabel", () => {
  it("names the party the place moved toward", () => {
    expect(swingLabel(3.25)).toBe("D+3.3");
    expect(swingLabel(-12)).toBe("R+12.0");
    expect(swingLabel(0.01)).toBe("No change");
  });
});
