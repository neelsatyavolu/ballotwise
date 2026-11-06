import type { Map as MapLibre } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { createExpression } from "@maplibre/maplibre-gl-style-spec";
import { hoverOutline, swingFill } from "../components/midterms/past/style";

/** A stand-in map that records each feature-state change. */
function fakeMap() {
  const calls: string[] = [];
  const map = {
    setFeatureState: (f: { sourceLayer: string; id: number }, state: { hover: boolean }) => calls.push(`${f.sourceLayer}:${f.id}=${state.hover}`),
  } as unknown as MapLibre;
  return { map, calls };
}

describe("hoverOutline", () => {
  it("outlines the hovered place and clears the last one", () => {
    const { map, calls } = fakeMap();
    const hover = hoverOutline(map);
    hover("precinct", 1);
    hover("precinct", 2);
    hover("county", 2);
    hover(null, undefined);
    expect(calls).toEqual(["precincts:1=true", "precincts:1=false", "precincts:2=true", "precincts:2=false", "counties:2=true", "counties:2=false"]);
  });

  it("does nothing while the pointer stays on the same place", () => {
    const { map, calls } = fakeMap();
    const hover = hoverOutline(map);
    hover("precinct", 7);
    hover("precinct", 7);
    hover(null, undefined);
    hover(null, undefined);
    expect(calls).toEqual(["precincts:7=true", "precincts:7=false"]);
  });
});

describe("swingFill", () => {
  const color = (shifts: Record<string, number>, co: string) => {
    const fill = swingFill(shifts);
    if (typeof fill === "string") return fill;
    const spec = { type: "color", "property-type": "data-driven", expression: { interpolated: false, parameters: ["zoom", "feature"] } };
    const parsed = createExpression(fill, "layers[0].paint.fill-color", spec as never);
    if (parsed.result !== "success") throw new Error(JSON.stringify(parsed.value));
    return String(parsed.value.evaluate({ zoom: 5 }, { type: 1, properties: { co } } as never));
  };

  it("shades a county by how far it moved and which way", () => {
    // 8 points toward the Republican: the second red step. 25 toward the Democrat: the darkest blue.
    expect(color({ "01001": -8 }, "01001")).toBe("rgba(240,141,132,1)");
    expect(color({ "01001": 25 }, "01001")).toBe("rgba(11,61,145,1)");
    expect(color({ "01001": 4.9 }, "01001")).toBe("rgba(198,216,248,1)");
  });

  it("grays a county with nothing to compare", () => {
    expect(color({ "01001": 3 }, "01003")).toBe("rgba(68,68,68,1)");
    expect(swingFill({})).toBe("#444");
  });
});
