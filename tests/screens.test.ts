import { describe, expect, it } from "vitest";
import { EXPIRE_MS, hiddenOn, roleOf, tileGrid, type Screen } from "../lib/midterms/screens";

const NOW = 1_000_000;
const screen = (id: string, over: Partial<Screen> = {}): Screen => ({ id, startedAt: 0, at: NOW, visible: true, area: 1000, panels: [], seen: [], solo: false, mock: null, ...over });

describe("second screens", () => {
  const ultrawide = screen("wide", { area: 5000, panels: ["control", "calls", "schedule"] });
  const laptop = screen("laptop", { area: 1200 });

  it("makes the biggest visible window main and the smaller one its companion", () => {
    expect(roleOf(ultrawide, [laptop], NOW).role).toBe("main");
    expect(roleOf(laptop, [ultrawide], NOW)).toEqual({ role: "companion", main: ultrawide });
  });

  it("stays solo alone, behind another tab in the same window, or next to a tab that went quiet", () => {
    expect(roleOf(laptop, [], NOW).role).toBe("solo");
    expect(roleOf(laptop, [{ ...ultrawide, visible: false }], NOW).role).toBe("solo");
    expect(roleOf({ ...laptop, visible: false }, [ultrawide], NOW).role).toBe("solo");
    expect(roleOf(laptop, [{ ...ultrawide, at: NOW - EXPIRE_MS }], NOW).role).toBe("solo");
  });

  it("lets a tab opt out of being a companion, and then the big one has no companion", () => {
    const solo = { ...laptop, solo: true };
    expect(roleOf(solo, [ultrawide], NOW).role).toBe("solo");
    expect(roleOf(ultrawide, [solo], NOW).role).toBe("solo");
  });

  it("breaks a tie in size by which tab opened first", () => {
    const a = screen("a", { startedAt: 1 });
    const b = screen("b", { startedAt: 2 });
    expect(roleOf(a, [b], NOW).role).toBe("main");
    expect(roleOf(b, [a], NOW).role).toBe("companion");
  });

  it("shows on the companion only what the main screen doesn't", () => {
    expect(hiddenOn(ultrawide)).toEqual(["tossups"]);
    expect(hiddenOn(screen("x", { panels: ["tossups", "control"] }))).toEqual(["calls", "schedule"]);
  });

  describe("toss-up tiles", () => {
    const opts = { gap: 10, card: 300, aspect: 1.3 };

    it("puts a couple of tiles side by side, each with a big map", () => {
      const g = tileGrid(2, 2000, 1000, opts);
      expect([g.cols, g.rows]).toEqual([2, 1]);
      expect(g.map).toBeCloseTo(910);
    });

    it("stacks no rows it doesn't need and fits every tile", () => {
      const g = tileGrid(5, 1440, 800, opts);
      expect(g.cols * g.rows).toBeGreaterThanOrEqual(5);
      expect(g.rows).toBe(1);
    });

    it("leaves no room for maps when too many tiles share a short screen", () => {
      expect(tileGrid(18, 1440, 800, opts).map).toBeLessThan(150);
    });
  });
});

