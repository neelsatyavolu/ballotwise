import { describe, expect, it } from "vitest";
import { districtMargin2024, margin2024Label, stateMargin2024 } from "../lib/midterms/past2024";

describe("2024 presidential margins", () => {
  it("reads a state's margin, Harris minus Trump", () => {
    expect(stateMargin2024("PA")).toBe(-1.7);
    expect(stateMargin2024("DE")).toBe(14.7);
    expect(stateMargin2024("XX")).toBeNull();
  });

  it("reads a House district as drawn for 2026, at-large seats as district 0", () => {
    expect(districtMargin2024("PA", 7)).toBe(-3.2);
    expect(districtMargin2024("WY", 0)).toBe(districtMargin2024("WY", null));
    expect(districtMargin2024("PA", 99)).toBeNull();
  });

  it("names the winner and the margin", () => {
    expect(margin2024Label(-13.14)).toBe("Trump +13.1");
    expect(margin2024Label(14.7)).toBe("Harris +14.7");
    expect(margin2024Label(0.01)).toBe("Even");
  });
});
