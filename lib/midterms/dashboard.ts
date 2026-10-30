import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../auth/accounts";
import { gridLayoutSchema, isGrid, type GridLayout } from "./decisionView";
import type { RaceSummary } from "./races";

/** A voter can keep this many dashboards. */
export const MAX_DASHBOARDS = 20;

export const layoutSchema = z.object({
  title: z.string().trim().min(1).max(80),
  sections: z
    .array(z.object({ title: z.string().max(120), note: z.string().max(400).default(""), raceIds: z.array(z.number().int()).max(80) }))
    .max(12),
});
export type Layout = z.infer<typeof layoutSchema>;
/** A saved dashboard is either Grok's sections of race cards or a Decision View grid of panels. */
export const storedLayoutSchema = z.union([gridLayoutSchema, layoutSchema]);
export type StoredLayout = Layout | GridLayout;
export type Dashboard = { id: string; layout: StoredLayout; updatedAt: number };

/** A voter types up to 2000 characters; the assistant's replies, sent back as history, run longer. */
export const chatMessageSchema = z
  .object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(6000) })
  .refine((m) => m.role === "assistant" || m.content.length <= 2000, "A message can be up to 2000 characters.");
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** A change the chat assistant makes to the voter's dashboards. */
export type Action = { type: "none" } | { type: "create"; layout: Layout } | { type: "update"; dashboardId: string; layout: Layout } | { type: "delete"; dashboardId: string };

/** The race list in the compact form the model reads. */
export function racesPrompt(races: readonly RaceSummary[]): string {
  return races
    .map((r) => {
      const leader = r.total > 0 && r.candidates[0] ? `${r.candidates[0].name} ${r.candidates[0].pct}%` : "";
      return [r.id, r.office, r.state, r.district ?? "", r.rating ?? "", leader, r.reporting ? Math.round(r.reporting) : "", r.title].join("|");
    })
    .join("\n");
}

/** Drops ids the catalog doesn't have, repeats within a section, and sections left empty. */
export function sanitizeLayout(layout: Layout, races: readonly RaceSummary[]): Layout {
  const known = new Set(races.map((r) => r.id));
  return {
    title: layout.title,
    sections: layout.sections
      .map((s) => ({ ...s, raceIds: [...new Set(s.raceIds)].filter((id) => known.has(id)) }))
      .filter((s) => s.raceIds.length > 0),
  };
}

export async function listDashboards(db: Db, userId: string): Promise<Dashboard[]> {
  const { results } = await db.prepare("SELECT id, layout, updated_at FROM midterm_dashboards WHERE user_id = ? ORDER BY created_at").bind(userId).all<{ id: string; layout: string; updated_at: number }>();
  return results.map((r) => ({ id: r.id, layout: JSON.parse(r.layout) as StoredLayout, updatedAt: r.updated_at }));
}

export async function createDashboard(db: Db, userId: string, layout: StoredLayout, now: number): Promise<string> {
  const id = randomUUID();
  await db.prepare("INSERT INTO midterm_dashboards (id, user_id, layout, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(id, userId, JSON.stringify(layout), now, now).run();
  return id;
}

/** Replaces a dashboard's layout. Only the owner's dashboards change. */
export async function updateDashboard(db: Db, userId: string, id: string, layout: StoredLayout, now: number): Promise<void> {
  await db.prepare("UPDATE midterm_dashboards SET layout = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(JSON.stringify(layout), now, id, userId).run();
}

/** Like updateDashboard, but only if nobody changed the dashboard since `seenAt`. Returns whether it saved. */
async function updateIfUnchanged(db: Db, userId: string, id: string, layout: Layout, seenAt: number, now: number): Promise<boolean> {
  await db.prepare("UPDATE midterm_dashboards SET layout = ?, updated_at = ? WHERE id = ? AND user_id = ? AND updated_at = ?").bind(JSON.stringify(layout), now, id, userId, seenAt).run();
  const row = await db.prepare("SELECT updated_at FROM midterm_dashboards WHERE id = ? AND user_id = ?").bind(id, userId).first<{ updated_at: number }>();
  return row?.updated_at === now;
}

export async function deleteDashboard(db: Db, userId: string, id: string): Promise<void> {
  await db.prepare("DELETE FROM midterm_dashboards WHERE id = ? AND user_id = ?").bind(id, userId).run();
}

export class DashboardError extends Error {}

/**
 * Applies the model's action to the voter's dashboards and returns the dashboard to show next.
 * Ids the model names must be the voter's own; race ids are checked against the catalog.
 * `seen` is the dashboards as the model saw them; an update to one changed since (renamed meanwhile, say) is refused.
 */
export async function applyAction(db: Db, userId: string, action: Action, races: readonly RaceSummary[], openId: string | null, now: number, seen?: readonly Dashboard[]): Promise<string | null> {
  const owned = await listDashboards(db, userId);
  const mine = (id: string) => owned.some((d) => d.id === id);
  if (action.type === "create") {
    if (owned.length >= MAX_DASHBOARDS) throw new DashboardError(`You can keep up to ${MAX_DASHBOARDS} dashboards. Delete one to make room.`);
    return createDashboard(db, userId, sanitizeLayout(action.layout, races), now);
  }
  if (action.type === "update" && mine(action.dashboardId)) {
    if (owned.some((d) => d.id === action.dashboardId && isGrid(d.layout))) throw new DashboardError("Grok can't rearrange a Decision View dashboard. Edit it on its page.");
    const seenAt = (seen ?? owned).find((d) => d.id === action.dashboardId)?.updatedAt;
    if (seenAt === undefined || !(await updateIfUnchanged(db, userId, action.dashboardId, sanitizeLayout(action.layout, races), seenAt, now))) {
      throw new DashboardError("That dashboard changed while Grok was working. Ask again to apply the change.");
    }
    return action.dashboardId;
  }
  if (action.type === "delete" && mine(action.dashboardId)) {
    await deleteDashboard(db, userId, action.dashboardId);
    return owned.find((d) => d.id !== action.dashboardId)?.id ?? null;
  }
  return openId;
}

/** Creates a Decision View dashboard, within the per-voter limit. */
export async function createGrid(db: Db, userId: string, layout: GridLayout, now: number): Promise<string> {
  if ((await listDashboards(db, userId)).length >= MAX_DASHBOARDS) throw new DashboardError(`You can keep up to ${MAX_DASHBOARDS} dashboards. Delete one to make room.`);
  return createDashboard(db, userId, layout, now);
}

/** Replaces one of the voter's dashboards with a grid layout. Returns whether it was theirs. */
export async function saveGrid(db: Db, userId: string, id: string, layout: GridLayout, now: number): Promise<boolean> {
  if (!(await listDashboards(db, userId)).some((d) => d.id === id)) return false;
  await updateDashboard(db, userId, id, layout, now);
  return true;
}

export async function renameDashboard(db: Db, userId: string, id: string, title: string, now: number): Promise<boolean> {
  const found = (await listDashboards(db, userId)).find((d) => d.id === id);
  if (!found) return false;
  await updateDashboard(db, userId, id, { ...found.layout, title }, now);
  return true;
}
