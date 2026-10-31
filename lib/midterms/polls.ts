// When polls close on Nov 3, 2026, for the election-night countdown and timeline.
// Times follow 270toWin's 2026 table: https://www.270towin.com/content/local-poll-closing-times-november-2026-general-election/

/** Midnight Eastern at the start of Nov 3. Daylight time ends Nov 1, so Eastern is UTC-5. */
export const ELECTION_DAY_START = Date.parse("2026-11-03T05:00:00Z");
const HOUR = 3_600_000;

/**
 * Hours after that midnight, Eastern, when most of a state's polls close, and when the rest do for states
 * split across time zones. 25 is 1 a.m. on Nov 4.
 */
export const POLL_CLOSE: Record<string, readonly [most: number, rest?: number]> = {
  IN: [18, 19], KY: [18, 19],
  FL: [19, 20], GA: [19], NH: [19, 20], SC: [19], VT: [19], VA: [19],
  NC: [19.5], OH: [19.5], WV: [19.5],
  AL: [20], CT: [20], DE: [20], DC: [20], IL: [20], KS: [20, 21], ME: [20], MD: [20], MA: [20], MI: [20, 21], MS: [20], MO: [20],
  NJ: [20], ND: [20, 21], OK: [20], PA: [20], RI: [20], SD: [20, 21], TN: [20], TX: [20, 21],
  AR: [20.5],
  AZ: [21], CO: [21], IA: [21], LA: [21], MN: [21], NE: [21], NM: [21], NY: [21], WI: [21], WY: [21],
  ID: [22, 23], MT: [22], NV: [22], UT: [22],
  CA: [23], OR: [23], WA: [23],
  HI: [24], AK: [24, 25],
};

const at = (hours: number) => ELECTION_DAY_START + hours * HOUR;

/** When most of a state's polls close, or null for a state not in the table. */
export function stateCloses(state: string): number | null {
  const hours = POLL_CLOSE[state];
  return hours ? at(hours[0]) : null;
}

/** When every poll in a state has closed, the earliest a race there can be called; null for a state not in the table. */
export function stateFinal(state: string): number | null {
  const hours = POLL_CLOSE[state];
  return hours ? at(hours[1] ?? hours[0]) : null;
}

/** Whether a state's polls close at two times, split across time zones. */
export const isSplit = (state: string) => POLL_CLOSE[state]?.[1] !== undefined;

/**
 * The races filed under a closing time: those in states whose first polls close then, since results start with them.
 * `partial` marks a state whose other polls close later, so its races can't be called until then (see stateFinal).
 */
export function filedAt<T extends { state: string }>(races: readonly T[], at: number): { race: T; partial: boolean }[] {
  return races.filter((r) => stateCloses(r.state) === at).map((race) => ({ race, partial: isSplit(race.state) }));
}

/** "all" for a state that closes at once; "most" and "rest" for the two halves of a split state. */
export type ClosePart = "all" | "most" | "rest";
export type CloseWave = { at: number; states: { state: string; part: ClosePart }[] };

/** Every closing time of the night, earliest first, with the states (or parts of states) closing then. */
export function closeWaves(): CloseWave[] {
  const entries = Object.entries(POLL_CLOSE).flatMap(([state, [most, rest]]): { state: string; part: ClosePart; at: number }[] =>
    rest === undefined ? [{ state, part: "all", at: at(most) }] : [{ state, part: "most", at: at(most) }, { state, part: "rest", at: at(rest) }],
  );
  const times = [...new Set(entries.map((e) => e.at))].sort((a, b) => a - b);
  return times.map((t) => ({
    at: t,
    states: entries
      .filter((e) => e.at === t)
      .map(({ state, part }) => ({ state, part }))
      .sort((a, b) => a.state.localeCompare(b.state)),
  }));
}

/** The next closing time after `now`, or null once every poll has closed. */
export function nextWave(now: number): CloseWave | null {
  return closeWaves().find((w) => w.at > now) ?? null;
}

/** Election mode is on by default from the start of Nov 3, Eastern, through the count that follows. */
export function electionModeDefault(now: number): boolean {
  return now >= ELECTION_DAY_START;
}

/** "02:05:09" until a time, with days in front when it's more than a day away: "3d 02:05:09". */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(s / 86_400);
  const clock = [Math.floor((s % 86_400) / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
  return days ? `${days}d ${clock}` : clock;
}

const EASTERN = "America/New_York";

function formatters(zone: string) {
  const name = (style: "short" | "shortGeneric" | "longGeneric") => {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: style });
    return (ms: number) => f.formatToParts(ms).find((p) => p.type === "timeZoneName")?.value ?? "";
  };
  const generic = name("shortGeneric");
  const plain = name("short");
  return {
    time: new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }),
    day: new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "short", day: "numeric" }),
    // "ET", "PT", "MST"; where the generic name is long ("United Kingdom Time"), the plain one ("GMT", "GMT+5:30").
    abbr: (ms: number) => (/^[A-Z]{1,4}$/.test(generic(ms)) ? generic(ms) : plain(ms)),
    long: name("longGeneric"),
  };
}

/**
 * The zone times are shown in. Eastern on the server and while a page hydrates, so the HTML matches; then the
 * viewer's own (see ZoneRoot). Server-side text (push alerts, the chat's tools) stays Eastern.
 */
let zone = EASTERN;
let fmt = formatters(EASTERN);

/** The browser's time zone, or Eastern when it can't say. */
export function viewerZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || EASTERN;
  } catch {
    return EASTERN;
  }
}

export function setTimeZone(next: string) {
  if (next === zone) return;
  try {
    fmt = formatters(next);
    zone = next;
  } catch {
    // An unknown zone keeps the current one.
  }
}

/** The zone's short name at `ms`: "ET", "PT", "GMT". */
export const zoneAbbr = (ms: number) => fmt.abbr(ms);

/** The zone's full name: "Eastern Time", "Pacific Time". */
export const zoneName = (ms: number) => fmt.long(ms);

/** "Nov 3" in the shown zone. */
export const dayLabel = (ms: number) => fmt.day.format(ms);

/** "7:30 PM" in the shown zone. Newer ICU puts a narrow no-break space before AM/PM; it becomes a plain one. */
export const timeOnly = (ms: number) => fmt.time.format(ms).replace(/\s/g, " ");

/** "7:30 PM ET", in the shown zone. */
export const formatTime = (ms: number) => `${timeOnly(ms)} ${zoneAbbr(ms)}`;

/** "9:29 PM" on Nov 3; on any other day the date goes in front: "Nov 4, 12:40 AM". In the shown zone, no zone name. */
export function stampTime(ms: number): string {
  const time = timeOnly(ms);
  const day = dayLabel(ms);
  return day === "Nov 3" ? time : `${day}, ${time}`;
}
