import { describe, expect, it } from "vitest";
import { wholePercents } from "../lib/midterms/view";

describe("wholePercents", () => {
  it("keeps two sides' rounded chances adding to 100", () => {
    expect(wholePercents([0.915, 0.085])).toEqual([92, 8]);
    expect(wholePercents([0.5, 0.5])).toEqual([50, 50]);
    expect(wholePercents([0.6, 0.4])).toEqual([60, 40]);
  });

  it("rounds each chance on its own otherwise", () => {
    expect(wholePercents([0.7, 0.2, 0.1])).toEqual([70, 20, 10]);
    expect(wholePercents([0.915, null])).toEqual([92, null]);
    expect(wholePercents([0.915])).toEqual([92]);
  });
});
