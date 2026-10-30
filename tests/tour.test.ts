import { describe, expect, it } from "vitest";
import { placeCard, spotlight } from "../lib/midterms/tour";

const viewport = { w: 1440, h: 900 };
const card = { w: 360, h: 180 };

describe("placeCard", () => {
  it("puts the card under the target, lined up with its left edge, when it fits", () => {
    expect(placeCard({ top: 100, left: 40, width: 600, height: 150 }, card, viewport)).toEqual({ top: 262, left: 40, side: "below" });
  });

  it("puts it above when there's no room below", () => {
    expect(placeCard({ top: 600, left: 40, width: 600, height: 200 }, card, viewport)).toEqual({ top: 408, left: 40, side: "above" });
  });

  it("puts it beside a target too tall for above or below, level with its top", () => {
    expect(placeCard({ top: 160, left: 12, width: 780, height: 600 }, card, viewport)).toEqual({ top: 160, left: 804, side: "right" });
    expect(placeCard({ top: 160, left: 800, width: 620, height: 600 }, card, viewport)).toEqual({ top: 160, left: 428, side: "left" });
    // A target reaching above the screen keeps the card in view.
    expect(placeCard({ top: -100, left: 12, width: 780, height: 1100 }, card, viewport).top).toBe(16);
  });

  it("pins it to the bottom of the screen when the target fills the screen", () => {
    expect(placeCard({ top: 20, left: 0, width: 1440, height: 860 }, card, viewport)).toEqual({ top: 704, left: 16, side: "pinned" });
    expect(placeCard({ top: 20, left: 4, width: 382, height: 760 }, card, { w: 390, h: 844 })).toEqual({ top: 648, left: 16, side: "pinned" });
  });

  it("keeps the card inside the screen's side gutters", () => {
    expect(placeCard({ top: 100, left: 1300, width: 120, height: 40 }, card, viewport).left).toBe(1440 - 360 - 16);
    expect(placeCard({ top: 100, left: 4, width: 120, height: 40 }, card, { w: 390, h: 844 }).left).toBe(16);
  });
});

describe("spotlight", () => {
  it("pads the target and trims it to the screen", () => {
    expect(spotlight({ top: 100, left: 40, width: 200, height: 50 }, viewport)).toEqual({ top: 94, left: 34, width: 212, height: 62 });
    expect(spotlight({ top: -300, left: 0, width: 1440, height: 2000 }, viewport)).toEqual({ top: 0, left: 0, width: 1440, height: 900 });
  });
});
