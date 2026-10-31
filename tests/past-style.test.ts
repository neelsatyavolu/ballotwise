import type { Map as MapLibre } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { hoverOutline } from "../components/midterms/past/style";

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
