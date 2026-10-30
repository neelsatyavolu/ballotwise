// Generic-ballot averages from the public aggregators Wikipedia tabulates (CC BY-SA), for when our own poll feed runs
// thin: "2026 United States House of Representatives elections", section "Generic congressional ballot aggregate polls".

export type Aggregate = { source: string; margin: number; updated: string };

const PAGE = "2026 United States House of Representatives elections";
const API = `https://en.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&prop=text&page=${encodeURIComponent(PAGE)}`;
export const AGGREGATES_SOURCE = `https://en.wikipedia.org/wiki/${PAGE.replace(/ /g, "_")}#Opinion_polling`;
/**
 * Left out of the median: Decision Desk HQ, because we check our forecast against theirs, and the table's own
 * "Average" row, which isn't an aggregator.
 */
const EXCLUDED = /decision desk|^average$/i;
/** An aggregate older than this isn't current enough to fill in for recent polls. */
const MAX_AGE_DAYS = 7;

const text = (html: string) =>
  html
    .replace(/<sup[\s\S]*?<\/sup>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&#160;|&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/\s+/g, " ")
    .trim();

/** The aggregator table's rows from the page's HTML: the first wikitable whose header names a "Source of poll aggregation". */
export function parseAggregates(html: string): Aggregate[] {
  for (const table of html.match(/<table class="wikitable[\s\S]*?<\/table>/g) ?? []) {
    const rows = (table.match(/<tr[\s\S]*?<\/tr>/g) ?? []).map((r) => [...r.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((m) => text(m[1])));
    const head = rows[0]?.join(" ") ?? "";
    if (!/source of poll\s*aggregation/i.test(head)) continue;
    const cols = rows[0];
    const updatedAt = cols.findIndex((c) => /updated/i.test(c));
    const out: Aggregate[] = [];
    for (const r of rows.slice(1)) {
      if (r.length !== cols.length) continue;
      const m = r.at(-1)?.match(/(Democrats|Republicans)\s*\+\s*([\d.]+)/i);
      const updated = Date.parse(r[updatedAt] ?? "");
      if (!m || !Number.isFinite(updated)) continue;
      out.push({ source: r[0], margin: (/^dem/i.test(m[1]) ? 1 : -1) * Number(m[2]), updated: new Date(updated).toISOString().slice(0, 10) });
    }
    return out;
  }
  return [];
}

/** The median margin of the current aggregators, with the ones it used; null when none qualifies. */
export function aggregateMedian(rows: readonly Aggregate[], now: number): { margin: number; sources: Aggregate[] } | null {
  const current = rows.filter((a) => !EXCLUDED.test(a.source) && now - Date.parse(`${a.updated}T12:00:00Z`) <= MAX_AGE_DAYS * 86_400_000);
  if (!current.length) return null;
  const sorted = current.map((a) => a.margin).sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const margin = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { margin: Math.round(margin * 10) / 10, sources: current };
}

export async function fetchAggregates(headers: Record<string, string>): Promise<Aggregate[]> {
  const res = await fetch(API, { headers, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Wikipedia returned ${res.status}`);
  return parseAggregates(((await res.json()) as { parse?: { text?: string } }).parse?.text ?? "");
}
