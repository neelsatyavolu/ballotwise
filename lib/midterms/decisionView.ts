// Decision View dashboards: a grid of panels people arrange themselves, after DDHQ's Decision View. Pure layout
// logic shared by the API (validation) and the editor (moves, templates, share links).
import { z } from "zod";
import { favoriteChance, type Office, type RaceSummary } from "./view";

export type ChamberOffice = Exclude<Office, "measure">;

/** What a panel shows, what it's about (a race, a chamber, or its own text) and the size it starts at. */
export const PANELS = {
  header: { label: "Section header", needs: "text", w: 8, h: 1 },
  topline: { label: "Topline Race Results", needs: "race", w: 6, h: 5 },
  map: { label: "Race Results Map", needs: "race", w: 6, h: 5 },
  market: { label: "Market Chart", needs: "race", w: 6, h: 4 },
  forecast: { label: "Race Forecast", needs: "race", w: 6, h: 5 },
  voteDrops: { label: "Vote Drop Feed", needs: "race", w: 6, h: 4 },
  voteHistory: { label: "Vote History Chart", needs: "race", w: 6, h: 4 },
  chamberControl: { label: "Chamber Control", needs: "office", w: 8, h: 4 },
  balanceTopline: { label: "Balance of Power Topline", needs: "office", w: 8, h: 3 },
  balanceMap: { label: "Balance of Power Map", needs: "office", w: 8, h: 7 },
  winChart: { label: "Forecast Win % Chart", needs: "office", w: 8, h: 4 },
  seatsChart: { label: "Forecast Seats Chart", needs: "office", w: 8, h: 4 },
  calls: { label: "Latest Calls", needs: "none", w: 6, h: 6 },
  pollClosings: { label: "Poll Closings", needs: "none", w: 6, h: 6 },
} as const;
export type PanelType = keyof typeof PANELS;
export const PANEL_TYPES = Object.keys(PANELS) as PanelType[];

export const GRID_SIZES = { "24x16": { cols: 24, rows: 16 }, "32x24": { cols: 32, rows: 24 } } as const;
export type GridSize = keyof typeof GRID_SIZES;

/**
 * The columns and rows the board is drawn with. A layout that stops a few columns short of the grid's right edge
 * (the Senate template uses 30 of 32) is drawn that wide, so it fills the window instead of leaving a strip; one
 * that fills at least half the grid's height sizes its rows to its own bottom, so it fills the window's height.
 * Sparser layouts keep the whole grid, with room to place things.
 */
export function fitted(panels: readonly Panel[], grid: { cols: number; rows: number }): { cols: number; fit: number } {
  const right = panels.reduce((m, p) => Math.max(m, p.x + p.w), 0);
  const bottom = panels.reduce((m, p) => Math.max(m, p.y + p.h), 0);
  const cols = right > 0 && grid.cols - right <= Math.ceil(grid.cols / 8) ? right : grid.cols;
  const fit = bottom >= grid.rows / 2 ? bottom : grid.rows;
  return { cols, fit };
}

/** Panels may run below the chosen rows (the board grows); this caps how far. */
const MAX_ROW = 200;
export const MAX_PANELS = 80;

const panelSchema = z.object({
  id: z.string().min(1).max(40),
  type: z.enum(PANEL_TYPES as [PanelType, ...PanelType[]]),
  x: z.number().int().min(0),
  y: z.number().int().min(0).max(MAX_ROW),
  w: z.number().int().min(1),
  h: z.number().int().min(1).max(MAX_ROW),
  raceId: z.number().int().positive().max(99_999_999).optional(),
  office: z.enum(["house", "senate", "governor"]).optional(),
  text: z.string().trim().max(80).optional(),
});
export type Panel = z.infer<typeof panelSchema>;

export const gridLayoutSchema = z
  .object({
    kind: z.literal("grid"),
    title: z.string().trim().min(1).max(80),
    size: z.enum(["24x16", "32x24"]),
    panels: z.array(panelSchema).max(MAX_PANELS),
  })
  .superRefine((layout, ctx) => {
    const { cols } = GRID_SIZES[layout.size];
    const ids = new Set<string>();
    layout.panels.forEach((p, i) => {
      if (p.x + p.w > cols) ctx.addIssue({ code: "custom", path: ["panels", i], message: "A panel runs past the grid's right edge." });
      if (ids.has(p.id)) ctx.addIssue({ code: "custom", path: ["panels", i, "id"], message: "Two panels share an id." });
      ids.add(p.id);
      const needs = PANELS[p.type].needs;
      if (needs === "race" && !p.raceId) ctx.addIssue({ code: "custom", path: ["panels", i], message: "This panel needs a race." });
      if (needs === "office" && !p.office) ctx.addIssue({ code: "custom", path: ["panels", i], message: "This panel needs a chamber." });
    });
  });
export type GridLayout = z.infer<typeof gridLayoutSchema>;

export const isGrid = <T extends object>(layout: T | GridLayout): layout is GridLayout => (layout as { kind?: unknown }).kind === "grid";

// ---------- Moving panels ----------

type Rect = { x: number; y: number; w: number; h: number };
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Puts one panel at `rect` (kept inside the grid's columns) and pushes any panel it now overlaps straight down,
 * repeatedly, until nothing overlaps. Returns a new list; the input isn't changed.
 */
export function place(panels: readonly Panel[], id: string, rect: Rect, cols: number): Panel[] {
  const w = Math.max(1, Math.min(rect.w, cols));
  const moved = { x: Math.max(0, Math.min(rect.x, cols - w)), y: Math.max(0, Math.min(rect.y, MAX_ROW)), w, h: Math.max(1, Math.min(rect.h, MAX_ROW)) };
  const out = panels.map((p) => (p.id === id ? { ...p, ...moved } : { ...p }));
  // Settle top to bottom: the moved panel keeps its spot, everything else gives way below what it hits.
  const order = [...out].sort((a, b) => (a.id === id ? -1 : b.id === id ? 1 : a.y - b.y || a.x - b.x));
  const settled: Panel[] = [];
  for (const p of order) {
    let next = p;
    for (let guard = 0; guard < MAX_PANELS * 2; guard++) {
      const hit = settled.find((s) => overlaps(s, next));
      if (!hit) break;
      next = { ...next, y: hit.y + hit.h };
    }
    settled.push(next);
  }
  const byId = new Map(settled.map((p) => [p.id, p]));
  return out.map((p) => byId.get(p.id)!);
}

/** The first row where a `w`×`h` panel fits at the left edge, below everything else when the grid is full. */
export function openSpot(panels: readonly Panel[], w: number, h: number, cols: number): { x: number; y: number } {
  const bottom = panels.reduce((m, p) => Math.max(m, p.y + p.h), 0);
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x + w <= cols; x++) if (!panels.some((p) => overlaps(p, { x, y, w, h }))) return { x, y };
  }
  return { x: 0, y: bottom };
}

let counter = 0;
/** A panel id unique within a dashboard. */
export const panelId = () => `p${Date.now().toString(36)}${(counter++).toString(36)}`;

// ---------- Templates ----------

/** One office's races, closest to a coin flip first, using the forecast. */
function closest(races: readonly RaceSummary[], office: ChamberOffice, n: number): RaceSummary[] {
  return races
    .filter((r) => r.office === office && r.signal)
    .sort((a, b) => favoriteChance(a) - favoriteChance(b))
    .slice(0, n);
}

type Draft = Omit<Panel, "id">;
const withIds = (drafts: Draft[]): Panel[] => drafts.map((d, i) => ({ ...d, id: `t${i}` }));

export const TEMPLATES = {
  senate: "Senate Dashboard",
  house: "House Midterms",
  midterm: "Midterm Dashboard",
} as const;
export type TemplateId = keyof typeof TEMPLATES;

/** A starting dashboard after DDHQ's examples, its races picked from our forecast's closest ones. */
export function template(id: TemplateId, races: readonly RaceSummary[]): GridLayout {
  if (id === "senate") {
    const top = closest(races, "senate", 10);
    const drafts: Draft[] = [{ type: "balanceTopline", office: "senate", x: 0, y: 0, w: 30, h: 3 }];
    top.slice(0, 5).forEach((r, i) => {
      drafts.push({ type: "topline", raceId: r.id, x: i * 6, y: 3, w: 6, h: 5 });
      drafts.push({ type: "map", raceId: r.id, x: i * 6, y: 8, w: 6, h: 5 });
    });
    top.slice(5, 10).forEach((r, i) => drafts.push({ type: "topline", raceId: r.id, x: i * 6, y: 13, w: 6, h: 5 }));
    return { kind: "grid", title: TEMPLATES.senate, size: "32x24", panels: withIds(drafts) };
  }
  if (id === "house") {
    const top = closest(races, "house", 6);
    const drafts: Draft[] = [];
    top.slice(0, 2).forEach((r, i) => {
      const y = i * 11;
      drafts.push({ type: "map", raceId: r.id, x: 0, y, w: 10, h: 6 });
      drafts.push({ type: "topline", raceId: r.id, x: 0, y: y + 6, w: 10, h: 5 });
      drafts.push({ type: "market", raceId: r.id, x: 10, y, w: 8, h: 4 });
      drafts.push({ type: "voteDrops", raceId: r.id, x: 10, y: y + 4, w: 8, h: 3 });
      drafts.push({ type: "voteHistory", raceId: r.id, x: 10, y: y + 7, w: 8, h: 4 });
    });
    top.slice(2, 6).forEach((r, i) => drafts.push({ type: "topline", raceId: r.id, x: 18 + (i % 2) * 7, y: Math.floor(i / 2) * 11, w: 7, h: 11 }));
    return { kind: "grid", title: TEMPLATES.house, size: "32x24", panels: withIds(drafts) };
  }
  const drafts: Draft[] = [];
  (["house", "senate", "governor"] as const).forEach((office, i) => {
    const x = i * 8;
    drafts.push({ type: "header", text: office === "house" ? "US House" : office === "senate" ? "US Senate" : "Governor", x, y: 0, w: 8, h: 1 });
    drafts.push({ type: office === "governor" ? "balanceTopline" : "chamberControl", office, x, y: 1, w: 8, h: 4 });
    drafts.push({ type: "balanceMap", office, x, y: 5, w: 8, h: 6 });
    if (office !== "governor") {
      drafts.push({ type: "seatsChart", office, x, y: 11, w: 4, h: 4 });
      drafts.push({ type: "winChart", office, x: x + 4, y: 11, w: 4, h: 4 });
    }
  });
  return { kind: "grid", title: TEMPLATES.midterm, size: "24x16", panels: withIds(drafts) };
}

/** An empty dashboard to build from scratch. */
export const blank = (title = "My dashboard"): GridLayout => ({ kind: "grid", title, size: "24x16", panels: [] });

/** A Grok-built dashboard as a grid: each section's header across the top of its block, then its races' toplines. */
export function fromSections(layout: { title: string; sections: readonly { title: string; raceIds: readonly number[] }[] }): GridLayout {
  const drafts: Draft[] = [];
  let y = 0;
  for (const s of layout.sections) {
    drafts.push({ type: "header", text: s.title.slice(0, 80), x: 0, y, w: 24, h: 1 });
    y += 1;
    s.raceIds.slice(0, 16).forEach((id, i) => drafts.push({ type: "topline", raceId: id, x: (i % 4) * 6, y: y + Math.floor(i / 4) * 5, w: 6, h: 5 }));
    y += Math.ceil(Math.min(s.raceIds.length, 16) / 4) * 5;
    if (drafts.length >= MAX_PANELS - 17) break;
  }
  return { kind: "grid", title: layout.title.slice(0, 80), size: "24x16", panels: withIds(drafts) };
}

// ---------- Share links ----------

/** A read-only link carries the whole layout, so sharing needs no account and exposes nothing else. */
export function encodeShare(layout: GridLayout): string {
  const bytes = new TextEncoder().encode(JSON.stringify(layout));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The layout a share link carries, or null when it's damaged or not a valid dashboard. */
export function decodeShare(code: string): GridLayout | null {
  try {
    const bin = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
    const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    const parsed = gridLayoutSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
