import { describe, expect, it, vi } from "vitest";
import { signUp } from "../lib/auth/accounts";
import { applyAction, chatTurn, createGrid, listDashboards, MAX_DASHBOARDS, saveGrid } from "../lib/midterms/dashboard";
import { blank, decodeShare, encodeShare, fitted, fromSections, GRID_SIZES, gridLayoutSchema, openSpot, place, template, type GridLayout, type Panel } from "../lib/midterms/decisionView";
import type { RaceSummary } from "../lib/midterms/view";
import { testDb } from "./sqlite-db";

const NOW = Date.UTC(2026, 9, 30);

/** A race with only what layouts read: office, place and the forecast's chances. */
const race = (id: number, office: RaceSummary["office"], d: number, state = "PA", district: number | null = null) =>
  ({ id, office, state, district, title: `${state} ${office} ${id}`, candidates: [], rating: null, signal: { market: null, polls: null, rating: null, forecast: { odds: { D: d, R: 1 - d } } } }) as unknown as RaceSummary;

const panel = (over: Partial<Panel>): Panel => ({ id: "a", type: "calls", x: 0, y: 0, w: 4, h: 4, ...over });
const grid = (panels: Panel[]): GridLayout => ({ kind: "grid", title: "Test", size: "24x16", panels });
const overlapping = (ps: readonly Panel[]) => ps.some((a, i) => ps.some((b, j) => i < j && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));

describe("grid layout schema", () => {
  it("accepts a valid layout and rejects panels past the edge, missing targets and repeated ids", () => {
    expect(gridLayoutSchema.safeParse(grid([panel({}), panel({ id: "b", type: "topline", raceId: 5, x: 4 })])).success).toBe(true);
    expect(gridLayoutSchema.safeParse(grid([panel({ x: 22, w: 4 })])).success).toBe(false);
    expect(gridLayoutSchema.safeParse(grid([panel({ type: "topline" })])).success).toBe(false);
    expect(gridLayoutSchema.safeParse(grid([panel({ type: "chamberControl" })])).success).toBe(false);
    expect(gridLayoutSchema.safeParse(grid([panel({}), panel({})])).success).toBe(false);
    expect(gridLayoutSchema.safeParse({ ...grid([]), size: "99x99" }).success).toBe(false);
  });
});

describe("moving panels", () => {
  it("pushes whatever a moved panel lands on straight down, without changing the input", () => {
    const panels = [panel({ id: "a", x: 0, y: 0 }), panel({ id: "b", x: 0, y: 4 }), panel({ id: "c", x: 0, y: 8 })];
    const moved = place(panels, "c", { x: 0, y: 0, w: 4, h: 4 }, 24);
    expect(moved.find((p) => p.id === "c")).toMatchObject({ x: 0, y: 0 });
    expect(overlapping(moved)).toBe(false);
    expect(panels[2]).toMatchObject({ y: 8 });
  });

  it("keeps panels inside the grid's columns", () => {
    expect(place([panel({})], "a", { x: 30, y: 0, w: 6, h: 2 }, 24)[0]).toMatchObject({ x: 18, w: 6 });
    expect(place([panel({})], "a", { x: 0, y: 0, w: 40, h: 2 }, 24)[0]).toMatchObject({ x: 0, w: 24 });
  });

  it("finds the first open spot, below everything when the grid is full", () => {
    expect(openSpot([panel({ w: 24, h: 2 })], 6, 3, 24)).toEqual({ x: 0, y: 2 });
    expect(openSpot([panel({ w: 12, h: 4 })], 6, 3, 24)).toEqual({ x: 12, y: 0 });
  });
});

describe("templates", () => {
  const races = [
    ...Array.from({ length: 12 }, (_, i) => race(100 + i, "senate", 0.5 + i * 0.04, ["TX", "OH", "ME", "AK", "IA", "KS", "FL", "GA", "MN", "MI", "NC", "NH"][i])),
    ...Array.from({ length: 8 }, (_, i) => race(200 + i, "house", 0.52 + i * 0.05, "PA", i + 1)),
    race(300, "governor", 0.6, "NV"),
  ];

  it("builds valid, non-overlapping layouts from the forecast's closest races", () => {
    for (const id of ["senate", "house", "midterm"] as const) {
      const layout = template(id, races);
      expect(gridLayoutSchema.safeParse(layout).success).toBe(true);
      expect(overlapping(layout.panels)).toBe(false);
    }
    const senate = template("senate", races);
    // The closest race (51-49) leads; the two least competitive of the twelve are left out.
    expect(senate.panels.find((p) => p.type === "topline")?.raceId).toBe(100);
    expect(senate.panels.some((p) => p.raceId === 111)).toBe(false);
    expect(template("midterm", races).panels.filter((p) => p.type === "header").map((p) => p.text)).toEqual(["US House", "US Senate", "Governor"]);
  });

  it("turns a Grok dashboard's sections into headers and toplines", () => {
    const layout = fromSections({ title: "Toss-ups", sections: [{ title: "Senate", raceIds: [100, 101] }, { title: "House", raceIds: [200] }] });
    expect(gridLayoutSchema.safeParse(layout).success).toBe(true);
    expect(layout.panels.map((p) => p.type)).toEqual(["header", "topline", "topline", "header", "topline"]);
    expect(overlapping(layout.panels)).toBe(false);
  });
});

describe("share links", () => {
  it("round-trip a layout and refuse a damaged one", () => {
    const layout = template("midterm", []);
    expect(decodeShare(encodeShare(layout))).toEqual(layout);
    expect(decodeShare("not-a-dashboard")).toBeNull();
    expect(decodeShare(encodeShare({ ...layout, panels: [panel({ x: 30 })] }))).toBeNull();
  });
});

describe("saved grid dashboards", () => {
  it("creates and saves grids only on the owner's account, within the limit", async () => {
    const db = testDb();
    const { user } = await signUp(db, "grid@example.com", "a long password", NOW);
    const { user: other } = await signUp(db, "nosy@example.com", "a long password", NOW);
    const id = await createGrid(db, user.id, blank("Mine"), NOW);
    expect(await saveGrid(db, user.id, id, grid([panel({})]), NOW + 1)).toBe(true);
    expect(await saveGrid(db, other.id, id, blank("Hijack"), NOW + 2)).toBe(false);
    const [saved] = await listDashboards(db, user.id);
    expect(saved.layout).toMatchObject({ kind: "grid", title: "Test", panels: [{ id: "a" }] });

    for (let i = 1; i < MAX_DASHBOARDS; i++) await createGrid(db, user.id, blank(`D${i}`), NOW);
    await expect(createGrid(db, user.id, blank("One too many"), NOW)).rejects.toThrow(/up to/);
  });

  it("keeps Grok away from grid dashboards", async () => {
    const db = testDb();
    const { user } = await signUp(db, "grok@example.com", "a long password", NOW);
    const id = await createGrid(db, user.id, blank("Grid"), NOW);
    const races = [race(100, "senate", 0.5)];
    await expect(applyAction(db, user.id, { type: "update", dashboardId: id, layout: { title: "X", sections: [] } }, races, id, NOW + 1)).rejects.toThrow(/Decision View/);

    const bodies: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      const text = JSON.stringify({ reply: "ok", action: { type: "none" } });
      const done = { type: "response.completed", response: { output: [{ type: "message", content: [{ text }] }] } };
      return new Response(`data: ${JSON.stringify(done)}\n\n`, { headers: { "content-type": "text/event-stream" } });
    });
    try {
      await chatTurn({ accessToken: "t", refreshToken: "r", expiresAt: NOW * 2 } as never, races, await listDashboards(db, user.id), id, [{ role: "user", content: "hi" }]);
    } finally {
      vi.unstubAllGlobals();
    }
    const sent = bodies.find((b) => b.includes('"input"')) ?? "";
    expect(sent).toContain("Open dashboard: none");
    expect(sent).not.toContain("kind");
  });
});

describe("grid sizes", () => {
  it("offers DDHQ's two board sizes", () => {
    expect(GRID_SIZES["24x16"]).toEqual({ cols: 24, rows: 16 });
    expect(GRID_SIZES["32x24"]).toEqual({ cols: 32, rows: 24 });
  });
});

describe("fitted", () => {
  const panel = (x: number, y: number, w: number, h: number): Panel => ({ id: `${x}-${y}`, type: "topline", raceId: 1, x, y, w, h });
  const grid = GRID_SIZES["32x24"];

  it("draws a layout a few columns short of the edge at its own width, so it fills the window", () => {
    const senate = template("senate", Array.from({ length: 10 }, (_, i) => race(i + 1, "senate", 0.5 + i / 100, "PA")));
    expect(fitted(senate.panels, grid)).toEqual({ cols: 30, fit: 18 });
  });

  it("keeps the whole grid for a sparse layout, with room to place things", () => {
    expect(fitted([panel(0, 0, 6, 5)], grid)).toEqual({ cols: 32, fit: 24 });
    expect(fitted([], grid)).toEqual({ cols: 32, fit: 24 });
  });

  it("sizes rows to the layout's bottom once it fills half the grid's height", () => {
    expect(fitted([panel(0, 0, 32, 11)], grid).fit).toBe(24);
    expect(fitted([panel(0, 0, 32, 12)], grid).fit).toBe(12);
    expect(fitted([panel(0, 0, 32, 30)], grid).fit).toBe(30);
  });
});
