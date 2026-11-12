import type { Db } from "../auth/accounts";

export type Summary =
  | { linked: false }
  | {
      linked: true;
      headline: string;
      items: { label: string; value: string }[];
      recent: { title: string; url: string; at: string }[];
      url: string;
    };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The card on the Xanom dashboard: guides, starred races and dashboards, plus the latest guides by title.
 * Never the voter's address, answers or values.
 */
export async function xanomSummary(db: Db, sub: string, appUrl: string): Promise<Summary> {
  const user = await db.prepare("SELECT id FROM users WHERE xanom_sub = ?").bind(sub).first<{ id: string }>();
  if (!user) return { linked: false };
  const counts = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM guides WHERE user_id = ?1) AS guides,
              (SELECT COUNT(*) FROM midterm_favorites WHERE user_id = ?1) AS stars,
              (SELECT COUNT(*) FROM midterm_dashboards WHERE user_id = ?1) AS dashboards`,
    )
    .bind(user.id)
    .first<{ guides: number; stars: number; dashboards: number }>();
  const { guides = 0, stars = 0, dashboards = 0 } = counts ?? {};
  const { results } = await db
    .prepare("SELECT id, title, updated_at FROM guides WHERE user_id = ? ORDER BY updated_at DESC LIMIT 3")
    .bind(user.id)
    .all<{ id: string; title: string; updated_at: number }>();
  return {
    linked: true,
    headline: `${plural(guides, "guide", "guides")} · ${plural(stars, "starred race", "starred races")}`,
    items: [
      { label: "Voter guides", value: String(guides) },
      { label: "Starred races", value: String(stars) },
      { label: "Dashboards", value: String(dashboards) },
    ],
    recent: results.map((g) => ({ title: g.title, url: `${appUrl}/guide/${encodeURIComponent(g.id)}`, at: new Date(g.updated_at).toISOString() })),
    url: `${appUrl}/`,
  };
}
