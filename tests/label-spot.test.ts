import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { labelSpot } from "../lib/midterms/labelSpot";

type Nation = { states: { state: string; d: string; box: [number, number, number, number] }[] };
const nation: Nation = JSON.parse(readFileSync(new URL("../public/midterms/maps/US.json", import.meta.url), "utf8"));
const shape = (st: string) => nation.states.find((s) => s.state === st)!;

describe("labelSpot", () => {
  it("puts Florida's label on the peninsula, clear of the Gulf coast", () => {
    const fl = shape("FL");
    const [x, y] = labelSpot("FL", fl.d)!;
    const [x0, y0, x1, y1] = fl.box;
    // The peninsula is the eastern part of the state, below the panhandle.
    expect(x).toBeGreaterThan(x0 + (x1 - x0) * 0.55);
    expect(y).toBeGreaterThan(y0 + (y1 - y0) * 0.35);
  });

  it("labels every big state inside its own box and skips small ones", () => {
    for (const s of nation.states) {
      const at = labelSpot(s.state, s.d);
      if (!at) continue;
      const [x0, y0, x1, y1] = s.box;
      expect(at[0]).toBeGreaterThanOrEqual(x0);
      expect(at[0]).toBeLessThanOrEqual(x1);
      expect(at[1]).toBeGreaterThanOrEqual(y0);
      expect(at[1]).toBeLessThanOrEqual(y1);
    }
    expect(labelSpot("RI", shape("RI").d)).toBeNull();
    expect(labelSpot("HI", shape("HI").d)).not.toBeNull();
  });
});
