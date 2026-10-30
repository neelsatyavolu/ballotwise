// General-election polls from Wikipedia's race articles (CC BY-SA), a second source beside VoteHub for Senate and
// governor races: VoteHub misses many polls DDHQ averages (Minnesota's Senate race: 7 to DDHQ's 22). Each article's
// "Polling" tables under "General election" are read into VoteHub's poll shape, so they average the same way;
// hypothetical matchups drop out there, since answers are matched to the race's nominees by name.
import type { VoteHubPoll } from "./pollAverage";
import type { RaceSummary } from "./races";
import { STATE_NAMES } from "./view";

const API = "https://en.wikipedia.org/w/api.php";
/** Titles per query: the API's limit for content. */
const BATCH = 50;
const DAY = 86_400_000;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** The race's Wikipedia article. */
export function pageTitle(office: "senate" | "governor", state: string, title: string): string {
  const name = STATE_NAMES[state] ?? state;
  if (office === "governor") return `2026 ${name} gubernatorial election`;
  return `2026 United States Senate ${/special/i.test(title) ? "special " : ""}election in ${name}`;
}

/** Templates (innermost first, so nested ones go too) and references removed, links reduced to their text. */
function plain(cell: string): string {
  let s = cell.replace(/<ref[^>]*\/>/g, "").replace(/<ref[\s\S]*?<\/ref>/g, "");
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(/\{\{[^{}]*\}\}/g, "");
  }
  s = s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").replace(/<br\s*\/?>/gi, " ");
  // What's left of a cell's attributes ("style=...|", a removed shading template's "|") sits before its last bar.
  s = s.slice(s.lastIndexOf("|") + 1);
  return s.replace(/'{2,}/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/** "October 19–26, 2026", "September 30 – October 2, 2026" or "October 21, 2026", as ISO dates. */
function fieldDates(text: string): { start: string; end: string } | null {
  const [a, b] = text.split(/\s*[–—-]\s*/);
  const part = (s: string) => s.match(/^([A-Za-z]+)?\.?\s*(\d{1,2}),?\s*(\d{4})?$/);
  const first = part(a ?? "");
  const last = b === undefined ? first : part(b);
  if (!first || !last) return null;
  const month = (m: string | undefined) => (m ? MONTHS.indexOf(m.toLowerCase()) + 1 : 0);
  const endMonth = month(last[1]) || month(first[1]);
  const endYear = Number(last[3] ?? first[3]);
  const startMonth = month(first[1]) || endMonth;
  if (!endMonth || !startMonth || !endYear) return null;
  const startYear = Number(first[3] ?? (startMonth > endMonth ? endYear - 1 : endYear));
  const iso = (y: number, m: number, d: string) => `${y}-${String(m).padStart(2, "0")}-${d.padStart(2, "0")}`;
  return { start: iso(startYear, startMonth, first[2]), end: iso(endYear, endMonth, last[2]) };
}

type Column = { role: "source" | "dates" | "sample" | "candidate" | "skip"; name?: string };

function column(header: string): Column {
  const h = plain(header);
  if (/poll source/i.test(h)) return { role: "source" };
  if (/administered/i.test(h)) return { role: "dates" };
  if (/sample/i.test(h)) return { role: "sample" };
  if (/margin|lead|other|undecided|none|would not|refused|updated/i.test(h) || !/[a-z]/i.test(h)) return { role: "skip" };
  return { role: "candidate", name: h.replace(/\s*\([^)]*\)\s*$/, "").trim() };
}

/** One table's polls; none when it isn't a table of individual polls (an aggregators' table, say). */
function tablePolls(table: string, subject: string): VoteHubPoll[] {
  const rows = table.split(/\n\|-[^\n]*/);
  const headers = rows.flatMap((r) => r.split("\n").filter((l) => l.startsWith("!")).flatMap((l) => l.slice(1).split("!!")));
  if (headers.some((h) => /aggregation/i.test(h))) return [];
  const columns = headers.map(column);
  const at = (role: Column["role"]) => columns.findIndex((c) => c.role === role);
  if (at("source") < 0 || at("dates") < 0 || columns.filter((c) => c.role === "candidate").length < 2) return [];
  const polls: VoteHubPoll[] = [];
  for (const row of rows) {
    const cells = row
      .split("\n")
      .filter((l) => l.startsWith("|") && !l.startsWith("|}"))
      .flatMap((l) => l.slice(1).split("||"));
    if (cells.length !== columns.length) continue;
    const dates = fieldDates(plain(cells[at("dates")]));
    if (!dates) continue;
    const source = plain(cells[at("source")]);
    const partisan = source.match(/\((R|D)\)\s*$/)?.[1];
    const sample = at("sample") < 0 ? "" : plain(cells[at("sample")]);
    const answers = columns.flatMap((c, i) => {
      const pct = plain(cells[i]).match(/^(\d+(?:\.\d+)?)%/);
      return c.role === "candidate" && pct ? [{ choice: c.name!, pct: Number(pct[1]) }] : [];
    });
    if (answers.length < 2) continue;
    polls.push({
      subject,
      pollster: source.replace(/\s*\((R|D)\)\s*$/, ""),
      start_date: dates.start,
      end_date: dates.end,
      sample_size: Number(sample.match(/^[\d,]+/)?.[0].replace(/,/g, "")) || null,
      population: sample.match(/\((LV|RV|A)\)/i)?.[1].toLowerCase() ?? null,
      partisan: partisan === "R" ? "REP" : partisan === "D" ? "DEM" : null,
      internal: /campaign/i.test(cells[at("source")]),
      answers,
    });
  }
  return polls;
}

/** The general election's polls in a race article's wikitext, under `subject` ("2026 Minnesota"). */
export function parseWikiPolls(wikitext: string, subject: string): VoteHubPoll[] {
  const general = wikitext.search(/==+\s*General election\s*==+/i);
  if (general < 0) return [];
  const rest = wikitext.slice(general);
  const polling = rest.search(/==+\s*Polling\s*==+/i);
  if (polling < 0) return [];
  const section = rest.slice(polling);
  const end = section.slice(1).search(/\n==[^=]|\n===\s*Results\s*===/);
  const body = end < 0 ? section : section.slice(0, end + 1);
  return body
    .split(/\n\{\|/)
    .slice(1)
    .flatMap((t) => tablePolls(t.split(/\n\|\}/)[0], subject));
}

const words = (pollster: string | undefined) =>
  new Set(
    (pollster ?? "")
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 4 && !["college", "university", "poll", "polls", "polling", "research", "group", "news", "times", "insights", "strategies"].includes(w)),
  );
const topShares = (p: VoteHubPoll) =>
  (p.answers ?? [])
    .map((a) => a.pct)
    .sort((a, b) => b - a)
    .slice(0, 2)
    .join("/");

/**
 * VoteHub's polls plus Wikipedia's that VoteHub doesn't have. A poll is the same one when it's in the same race, ends
 * within a day, and shares a distinctive word of the pollster's name or the same top two shares.
 */
export function mergePolls(primary: readonly VoteHubPoll[], extra: readonly VoteHubPoll[]): VoteHubPoll[] {
  const same = (a: VoteHubPoll, b: VoteHubPoll) => {
    if (a.subject !== b.subject || !a.end_date || !b.end_date) return false;
    if (Math.abs(Date.parse(a.end_date) - Date.parse(b.end_date)) > DAY) return false;
    const wa = words(a.pollster);
    return [...words(b.pollster)].some((w) => wa.has(w)) || topShares(a) === topShares(b);
  };
  return [...primary, ...extra.filter((p) => !primary.some((q) => same(p, q)))];
}

type QueryPage = { title: string; revisions?: { slots?: { main?: { content?: string } } }[] };
type QueryResponse = { query?: { pages?: QueryPage[]; normalized?: { from: string; to: string }[]; redirects?: { from: string; to: string }[] } };

/** Every Senate or governor race's Wikipedia polls, from its article. Throws when Wikipedia doesn't answer. */
export async function fetchWikiPolls(office: "senate" | "governor", races: readonly RaceSummary[], headers: Record<string, string>): Promise<VoteHubPoll[]> {
  const wanted = races.filter((r) => r.office === office).map((r) => ({ title: pageTitle(office, r.state, r.title), subject: `2026 ${STATE_NAMES[r.state] ?? r.state}` }));
  const polls: VoteHubPoll[] = [];
  for (let i = 0; i < wanted.length; i += BATCH) {
    const batch = wanted.slice(i, i + BATCH);
    const params = new URLSearchParams({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", format: "json", formatversion: "2", redirects: "1", titles: batch.map((w) => w.title).join("|") });
    const res = await fetch(`${API}?${params}`, { headers, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Wikipedia returned ${res.status}`);
    const { query } = (await res.json()) as QueryResponse;
    const moved = new Map([...(query?.normalized ?? []), ...(query?.redirects ?? [])].map((m) => [m.from, m.to]));
    const content = new Map((query?.pages ?? []).map((p) => [p.title, p.revisions?.[0]?.slots?.main?.content ?? ""]));
    for (const w of batch) {
      let title = w.title;
      for (let hops = 0; moved.has(title) && hops < 3; hops++) title = moved.get(title)!;
      polls.push(...parseWikiPolls(content.get(title) ?? "", w.subject));
    }
  }
  return polls;
}
