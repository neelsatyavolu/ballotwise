// Which tracked races are on the voter's ballot, for the Near you screen and its companion.
import type { LocalAnswer } from "./local";
import type { Office, RaceSummary } from "./view";

/** Top of the ticket first, as on a ballot. */
const TICKET: Office[] = ["governor", "senate", "house"];

type Local = NonNullable<LocalAnswer["local"]>;

/** A statewide measure's number ("proposition 1"), to match the same measure across sources. */
const measureKey = (title: string) => title.match(/\b(Proposition|Question|Amendment|Measure|Issue|Initiative|Referendum)\s+(\d+[A-Z]?)\b/i)?.slice(1, 3).join(" ").toLowerCase() ?? null;

/**
 * The state's measures with DDHQ's statewide counts (`local.measures`, from its county page) wherever DDHQ has counted
 * more than civicAPI, keeping the tracked race's title, summary and call; a measure only DDHQ lists is added.
 */
function withDdhqMeasures(measures: readonly RaceSummary[], ddhq: readonly RaceSummary[] = []): RaceSummary[] {
  const byKey = new Map(ddhq.flatMap((r) => (measureKey(r.title) ? [[measureKey(r.title)!, r] as const] : [])));
  const used = new Set<string>();
  const merged = measures.map((m) => {
    const key = measureKey(m.title);
    const d = key ? byKey.get(key) : undefined;
    if (!d) return m;
    used.add(key!);
    if (d.total <= m.total) return m;
    // DDHQ's votes with our own call: its winner marks would show a call our log hasn't made, or hide one it has.
    const won = new Set(m.candidates.filter((c) => c.winner).map((c) => c.name.toLowerCase()));
    const candidates = d.candidates.map((c) => ({ ...c, winner: won.has(c.name.toLowerCase()) }));
    return { ...m, total: d.total, reporting: d.reporting, reportingUnknown: d.reportingUnknown, expected: d.expected, candidates };
  });
  return [...merged, ...[...byKey].filter(([key]) => !used.has(key)).map(([, r]) => r)];
}

/** The tracked races at the voter's address: governor, Senate and House first, as on a ballot, then statewide measures. */
export function trackedAt(local: Local, races: readonly RaceSummary[]): { ticket: RaceSummary[]; measures: RaceSummary[] } {
  const mine = races.filter((r) => r.state === local.state && (r.office !== "house" || r.district === local.house));
  return {
    ticket: mine.filter((r) => r.office !== "measure").sort((a, b) => TICKET.indexOf(a.office) - TICKET.indexOf(b.office)),
    measures: withDdhqMeasures(mine.filter((r) => r.office === "measure"), local.measures),
  };
}

/** Every race on the voter's ballot in ballot order: the top of the ticket, legislature, city and school, the rest nearby, measures. */
export function ballotRaces(local: Local, races: readonly RaceSummary[]): RaceSummary[] {
  const { ticket, measures } = trackedAt(local, races);
  return [...ticket, ...local.legislature, ...local.yours, ...local.nearby, ...measures];
}
