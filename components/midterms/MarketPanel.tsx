"use client";

import { useMemo, useState } from "react";
import type { Line, MarketBook, RaceMarkets } from "@/lib/midterms/marketHistory";
import { useLive } from "./hooks";
import { LineChart } from "./LineChart";

type Source = "polymarket" | "kalshi";
type Range = "all" | "live";
const SOURCE_LABEL: Record<Source, string> = { polymarket: "Polymarket", kalshi: "Kalshi" };

/** Brighter party hues for 2px lines on the dark card (the base party colors fall under 3:1 there). */
const LINE_COLOR = { D: "var(--dem-ink)", R: "var(--rep-ink)", I: "var(--oth)" } as const;
/** An outcome with no known party, such as someone who lost the primary but still trades: neutral, not "independent". */
const NO_PARTY = "var(--muted)";

const pct = (p: number) => `${(p * 100).toFixed(2)}%`;
const day = (t: number) => new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const hour = (t: number) => new Date(t * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" });

/** Each line's color, and a dash for a second candidate of the same party, so no two lines look alike. */
function styles(lines: readonly Line[]) {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const color = l.side ? LINE_COLOR[l.side] : NO_PARTY;
    const n = seen.get(color) ?? 0;
    seen.set(color, n + 1);
    return { color, dash: n === 0 ? undefined : n === 1 ? "6 4" : "2 3" };
  });
}

function Chart({ lines, range }: { lines: readonly Line[]; range: Range }) {
  const look = styles(lines);
  return (
    <LineChart
      lines={lines.map((l, i) => ({ name: l.name, color: look[i].color, dash: look[i].dash, points: range === "all" ? l.all : l.live }))}
      ticks={[0, 0.5, 1]}
      value={(p) => (p === 0 || p === 0.5 || p === 1 ? `${p * 100}%` : pct(p))}
      date={range === "all" ? day : hour}
      label={`Price history: ${lines.map((l) => `${l.name} ${pct(l.now)}`).join(", ")}`}
      empty={`No trades ${range === "live" ? "in the last two days" : "yet"}.`}
    />
  );
}

function Book({ book, range, setRange }: { book: MarketBook; range: Range; setRange: (r: Range) => void }) {
  const lead = book.lines[0];
  const look = styles(book.lines);
  return (
    <div className="mt-mk-card">
      <div className="mt-mk-top">
        <p className="mt-mk-q">{book.question}</p>
        <div className="mt-seg" role="group" aria-label="Time range">
          {(["all", "live"] as const).map((r) => (
            <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)} title={r === "all" ? "Since the market opened" : "The last two days"}>
              {r === "all" ? "All" : "Live"}
            </button>
          ))}
        </div>
      </div>
      {lead && <p className="mt-mk-lead">{lead.name} {pct(lead.now)}</p>}
      <Chart lines={book.lines} range={range} />
      <ul className="mt-mk-legend">
        {book.lines.map((l, i) => (
          <li key={l.name}>
            <svg width="16" height="8" aria-hidden><line x1="0" x2="16" y1="4" y2="4" style={{ stroke: look[i].color }} strokeWidth="2" strokeDasharray={look[i].dash} /></svg>
            {l.name} <span>{pct(l.now)}</span>
          </li>
        ))}
      </ul>
      <a className="mt-mk-src small" href={book.url} target="_blank" rel="noreferrer">See this market →</a>
    </div>
  );
}

/** Prediction-market prices for one race over time, from Polymarket or Kalshi; nothing at all when neither lists it. */
export function MarketPanel({ raceId }: { raceId: number }) {
  const { data } = useLive<RaceMarkets>(`/api/midterms/race/${raceId}/markets`);
  const sources = useMemo(() => (["polymarket", "kalshi"] as const).filter((s) => data?.[s]?.lines.length), [data]);
  const [picked, setPicked] = useState<Source | null>(null);
  const [range, setRange] = useState<Range>("all");
  if (!data || !sources.length) return null;
  const source = picked && sources.includes(picked) ? picked : sources[0];
  return (
    <section className="mt-mk" aria-label="Prediction markets">
      <h3 className="mt-mk-head">Markets</h3>
      <div className="mt-seg mt-mk-sources" role="group" aria-label="Market">
        {sources.map((s) => (
          <button key={s} type="button" aria-pressed={source === s} onClick={() => setPicked(s)}>
            {SOURCE_LABEL[s]}
          </button>
        ))}
      </div>
      <Book book={data[source]!} range={range} setRange={setRange} />
    </section>
  );
}
