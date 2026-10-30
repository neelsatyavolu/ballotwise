import { describe, expect, it } from "vitest";
import { parseWeights, resize } from "../lib/midterms/columns";

describe("resize", () => {
  const mins = [300, 300, 300];

  it("moves the divider between two columns by the pixels dragged, leaving the rest alone", () => {
    // 3,000px across three equal columns: 1,000px per share.
    expect(resize([1, 1, 1], 0, 200, 3000, mins)).toEqual([1.2, 0.8, 1]);
    expect(resize([1, 1, 1], 1, -100, 3000, mins)).toEqual([1, 0.9, 1.1]);
  });

  it("stops each column at its narrowest", () => {
    expect(resize([1, 1, 1], 0, 900, 3000, mins)).toEqual([1.7, 0.3, 1]);
    expect(resize([1, 1, 1], 1, -1000, 3000, mins)).toEqual([1, 0.3, 1.7]);
  });
});

describe("parseWeights", () => {
  it("reads saved widths, and ignores a damaged or mismatched copy", () => {
    expect(parseWeights("[1.2,0.8,1,0.6]", 4)).toEqual([1.2, 0.8, 1, 0.6]);
    expect(parseWeights("[1,1]", 4)).toBeNull();
    expect(parseWeights("[1,-1,1,1]", 4)).toBeNull();
    expect(parseWeights("not json", 4)).toBeNull();
    expect(parseWeights(null, 4)).toBeNull();
  });
});
