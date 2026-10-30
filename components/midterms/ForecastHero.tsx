// Rendered inside the Forecast tab: the headline, each party's chance, and the chart over time.
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { headline, RATING_KEYS, weekChange, type ChamberView, type ForecastOffice, type RatingKey } from "@/lib/midterms/forecastTab";
import { LineChart, type ChartPoint } from "./LineChart";

const STAMP = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const whole = (v: number) => `${Math.round(v * 100)}%`;
/**
 * The hero chart's box in SVG units, matched to its width on screen so labels stay at their normal size on a wide
 * page and on a phone alike.
 */
function useChartSize(): [(el: HTMLDivElement | null) => void, { w: number; h: number }] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [w, setW] = useState(1200);
  useEffect(() => {
    if (!el) return;
    const watch = new ResizeObserver(([entry]) => setW(Math.max(320, Math.round(entry.contentRect.width))));
    watch.observe(el);
    return () => watch.disconnect();
  }, [el]);
  return [setEl, { w, h: Math.round(Math.min(320, Math.max(200, w * 0.28))) }];
}

/** A donkey, drawn plainly in white for the Democratic badge. */
function Donkey() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className="mt-fc-icon">
      <rect x="5" y="14" width="17" height="8" rx="3.5" />
      <path d="M18.5 16 L21.5 7.5 L27.5 9.5 L25 17 Z" />
      <path d="M21.6 8 L20.6 2.2 L23.4 7.2 Z M24.2 8.8 L25 2.8 L26.4 8.6 Z" />
      <rect x="6.5" y="20" width="2.4" height="7.5" rx="1" />
      <rect x="10.5" y="20" width="2.4" height="7.5" rx="1" />
      <rect x="15.5" y="20" width="2.4" height="7.5" rx="1" />
      <rect x="19" y="20" width="2.4" height="7.5" rx="1" />
      <path d="M5.5 15.5 L2.5 20" strokeWidth="1.6" stroke="currentColor" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** An elephant, drawn plainly in white for the Republican badge. */
function Elephant() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className="mt-fc-icon">
      <ellipse cx="18" cy="15.5" rx="10" ry="7" />
      <circle cx="8.5" cy="13" r="5.2" />
      <path d="M4.6 15 Q3 22 6.5 24.5" strokeWidth="2.4" stroke="currentColor" fill="none" strokeLinecap="round" />
      <rect x="11" y="19" width="3.2" height="8" rx="1.2" />
      <rect x="15.5" y="19" width="3.2" height="8" rx="1.2" />
      <rect x="20.5" y="19" width="3.2" height="8" rx="1.2" />
      <rect x="24.5" y="19" width="3.2" height="8" rx="1.2" />
    </svg>
  );
}

/** "↗ 1W" when the chance moved up over the last week, "↘ 1W" when down; nothing until the history reaches back a week. */
function WeekBadge({ change }: { change: number | null }) {
  if (change === null || Math.abs(change) < 0.005) return null;
  return <span className={`mt-fc-week ${change > 0 ? "up" : "down"}`} title={`${change > 0 ? "+" : ""}${Math.round(change * 100)} points over the last week`}>{change > 0 ? "↗" : "↘"} 1W</span>;
}

/** Both parties' chance of control, with a split bar under them. */
export function PartyOdds({ dControl, control }: { dControl: number; control: readonly ChartPoint[] }) {
  const change = weekChange(control);
  return (
    <div className="mt-fc-odds">
      <div className="mt-fc-party d">
        <span className="mt-fc-badge d"><Donkey /></span>
        <div>
          <span className="mt-fc-name">Democrats</span>
          <span className="mt-fc-p">{whole(dControl)} <WeekBadge change={change} /></span>
          <span className="mt-fc-sub">Probability</span>
        </div>
      </div>
      <div className="mt-fc-party r">
        <div>
          <span className="mt-fc-name">Republicans</span>
          <span className="mt-fc-p"><WeekBadge change={change === null ? null : -change} /> {whole(1 - dControl)}</span>
          <span className="mt-fc-sub">Probability</span>
        </div>
        <span className="mt-fc-badge r"><Elephant /></span>
      </div>
      <div className="mt-fc-split" role="img" aria-label={`Democrats ${whole(dControl)}, Republicans ${whole(1 - dControl)}`}>
        <span style={{ width: `${dControl * 100}%` }} />
      </div>
    </div>
  );
}

/** Expected seats for each party, for governorships and before the simulation has run. */
function PartySeats({ view, office }: { view: ChamberView; office: ForecastOffice }) {
  const unit = office === "governor" ? "governorships" : "seats";
  return (
    <div className="mt-fc-odds">
      <div className="mt-fc-party d">
        <span className="mt-fc-badge d"><Donkey /></span>
        <div>
          <span className="mt-fc-name">Democrats</span>
          <span className="mt-fc-p">{view.dSeats}</span>
          <span className="mt-fc-sub">Projected {unit}</span>
        </div>
      </div>
      <div className="mt-fc-party r">
        <div>
          <span className="mt-fc-name">Republicans</span>
          <span className="mt-fc-p">{view.rSeats}</span>
          <span className="mt-fc-sub">Projected {unit}</span>
        </div>
        <span className="mt-fc-badge r"><Elephant /></span>
      </div>
      <div className="mt-fc-split" role="img" aria-label={`Democrats ${view.dSeats}, Republicans ${view.rSeats}`}>
        <span style={{ width: `${(view.dSeats / Math.max(1, view.dSeats + view.rSeats)) * 100}%` }} />
      </div>
    </div>
  );
}

/**
 * The top of a forecast page: brand, headline, update time, each party's chance (or projected seats for governors)
 * and a chart that switches between win probability and seat count over time.
 */
export function ForecastHero({ office, view, updatedAt, control, seats, action, marker }: {
  office: ForecastOffice;
  view: ChamberView;
  updatedAt: number | null;
  /** Democrats' chance of control by day. */
  control: readonly ChartPoint[];
  /** Expected seats by day. */
  seats: { D: readonly ChartPoint[]; R: readonly ChartPoint[] };
  /** Extra controls under the methodology line (the overview's "View full forecast"). */
  action?: ReactNode;
  /** A day to mark on the chart, such as when prediction markets joined the forecast. */
  marker?: { t: number; label: string } | null;
}) {
  const hasControl = view.dControl !== null;
  const [tab, setTab] = useState<"win" | "seats">("win");
  const showing = hasControl ? tab : "seats";
  const parts = headline(office, view);
  const [chartBox, chartSize] = useChartSize();
  const date = (t: number) => DAY.format(t * 1000);
  return (
    <section className="mt-fc-hero">
      <p className="mt-fc-brand">Ballotwise Forecast</p>
      <h1 className="mt-fc-head">
        {parts.map((p, i) => (
          <span key={i} className={`t-${p.tone}`}>
            {i > 0 && " "}
            {p.text}
          </span>
        ))}
      </h1>
      {updatedAt && <p className="mt-fc-stamp">Last updated {STAMP.format(updatedAt)}</p>}
      <p className="mt-fc-how">
        How this forecast works: read the <Link href="/midterms/methodology">methodology</Link>.
      </p>
      {action}
      {hasControl ? <PartyOdds dControl={view.dControl!} control={control} /> : <PartySeats view={view} office={office} />}
      {hasControl && (
        <div className="mt-seg mt-fc-tabs" role="group" aria-label="Chart shows">
          <button type="button" aria-pressed={showing === "win"} onClick={() => setTab("win")}>Win Probability</button>
          <button type="button" aria-pressed={showing === "seats"} onClick={() => setTab("seats")}>Seat Count</button>
        </div>
      )}
      <div ref={chartBox}>
      {showing === "win" ? (
        <LineChart
          lines={[
            { name: "Democrats", color: "var(--dem-ink)", points: control },
            { name: "Republicans", color: "var(--rep-ink)", points: control.map(([t, v]) => [t, 1 - v] as const) },
          ]}
          domain={[0, 1]}
          ticks={[0, 0.25, 0.5, 0.75, 1]}
          value={whole}
          date={date}
          label={`Chance of winning the ${office === "house" ? "House" : "Senate"} over time`}
          empty="The chart fills in as the forecast records each day's chance."
          marker={marker ?? undefined}
          size={chartSize}
        />
      ) : (
        <LineChart
          lines={[
            { name: "Democrats", color: "var(--dem-ink)", points: seats.D },
            { name: "Republicans", color: "var(--rep-ink)", points: seats.R },
            ...(view.majority && seats.D.length > 1 ? [{ name: `${view.majority} for control`, color: "var(--muted)", dash: "4 4", points: [[seats.D[0][0], view.majority], [seats.D[seats.D.length - 1][0], view.majority]] as ChartPoint[] }] : []),
          ]}
          domain="auto"
          step={5}
          value={(v) => `${Math.round(v)}`}
          date={date}
          label={`Projected ${office === "governor" ? "governorships" : "seats"} over time`}
          empty="The chart fills in as the forecast records each day's projected seats."
          marker={marker ?? undefined}
          size={chartSize}
        />
      )}
      </div>
      {marker && (
        <p className="mt-fc-note">
          Days before {marker.label.replace("Markets added ", "")} were recomputed from polls and fundamentals alone; prediction markets joined the
          forecast that day, so the step there is the new input, not an overnight swing.
        </p>
      )}
    </section>
  );
}

const RATING_TEXT: Record<RatingKey, string> = { safeD: "Safe D", likelyD: "Likely D", leanD: "Lean D", tossup: "Toss-up", leanR: "Lean R", likelyR: "Likely R", safeR: "Safe R" };
const RATING_VAR: Record<RatingKey, string> = { safeD: "var(--rate-safe-d)", likelyD: "var(--rate-likely-d)", leanD: "var(--rate-lean-d)", tossup: "var(--rate-tossup)", leanR: "var(--rate-lean-r)", likelyR: "var(--rate-likely-r)", safeR: "var(--rate-safe-r)" };

/** Every seat by rating in one bar, Democrats from the left, with the majority marked. */
export function SeatsByRating({ view, office }: { view: ChamberView; office: ForecastOffice }) {
  const counted = RATING_KEYS.reduce((s, k) => s + view.ratings[k], 0) + view.ratings.other;
  const total = Math.max(1, counted);
  // A count shows only in a segment wide enough to hold it; the bar's label and each segment's title carry them all.
  const label = (n: number) => (n / total >= 0.04 ? n : "");
  return (
    <div className="mt-fc-seats">
      <div className="mt-fc-seats-head">
        <span className="mt-fc-total d"><b>{view.dSeats}</b> Democrats</span>
        <span className="mt-fc-legend">
          {(["safe", "likely", "lean"] as const).map((t) => (
            <span key={t}>
              <i style={{ background: `linear-gradient(135deg, var(--rate-${t}-r) 50%, var(--rate-${t}-d) 50%)` }} /> {t[0].toUpperCase() + t.slice(1)}
            </span>
          ))}
          <span>
            <i style={{ background: "var(--rate-tossup)" }} /> Toss-up
          </span>
        </span>
        <span className="mt-fc-total r">Republicans <b>{view.rSeats}</b></span>
      </div>
      <div className="mt-fc-seatbar" role="img" aria-label={RATING_KEYS.map((k) => `${RATING_TEXT[k]} ${view.ratings[k]}`).join(", ")}>
        {RATING_KEYS.slice(0, 4).map((k) => view.ratings[k] > 0 && <span key={k} className={k === "tossup" ? "dark" : undefined} style={{ width: `${(view.ratings[k] / total) * 100}%`, background: RATING_VAR[k] }} title={`${RATING_TEXT[k]}: ${view.ratings[k]}`}>{label(view.ratings[k])}</span>)}
        {view.ratings.other > 0 && <span style={{ width: `${(view.ratings.other / total) * 100}%`, background: "var(--oth)" }} title={`Independent or no forecast: ${view.ratings.other}`}>{label(view.ratings.other)}</span>}
        {RATING_KEYS.slice(4).map((k) => view.ratings[k] > 0 && <span key={k} style={{ width: `${(view.ratings[k] / total) * 100}%`, background: RATING_VAR[k] }} title={`${RATING_TEXT[k]}: ${view.ratings[k]}`}>{label(view.ratings[k])}</span>)}
        {view.majority && <i className="mt-fc-majority" style={{ left: `${(view.majority / total) * 100}%` }} />}
      </div>
      {view.majority ? (
        <p className="mt-fc-control" style={{ paddingLeft: `${(view.majority / total) * 100}%` }}>
          <span>{view.majority} for control</span>
        </p>
      ) : (
        <p className="muted small">{office === "governor" ? `Includes the ${view.notUp.D + view.notUp.R + view.notUp.other} governors not up this year.` : ""}</p>
      )}
    </div>
  );
}

/** A compact control card for the overview: the party chances and split bar, or projected seats for governors. */
export function ControlCard({ title, view, href, office, control }: { title: string; view: ChamberView; href: string; office: ForecastOffice; control: readonly ChartPoint[] }) {
  return (
    <section className="mt-fc-card">
      <h2>
        <Link href={href}>{title}</Link>
      </h2>
      {view.dControl !== null ? <PartyOdds dControl={view.dControl} control={control} /> : <PartySeats view={view} office={office} />}
    </section>
  );
}
