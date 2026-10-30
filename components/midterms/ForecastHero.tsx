// Rendered inside the Forecast tab: the headline, each party's chance, and the chart over time.
import { useEffect, useState, type ReactNode } from "react";
import { headline, RATING_KEYS, weekChange, type ChamberView, type ForecastOffice, type RatingKey } from "@/lib/midterms/forecastTab";
import { LineChart, type ChartPoint } from "./LineChart";

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const whole = (v: number) => `${Math.round(v * 100)}%`;
/**
 * The hero chart's box in SVG units, matched to its width on screen so labels stay at their normal size on a wide
 * page and on a phone alike.
 */
function useChartSize(): [(el: HTMLDivElement | null) => void, { w: number; h: number }] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    if (!el) return;
    const watch = new ResizeObserver(([entry]) => setW(Math.max(320, Math.round(entry.contentRect.width))));
    watch.observe(el);
    return () => watch.disconnect();
  }, [el]);
  return [setEl, { w, h: Math.round(Math.min(280, Math.max(200, w * 0.36))) }];
}

/** "Dem up 4 points this week"; nothing until the history reaches back a week or when it hasn't moved a point. */
function weekText(change: number | null): string {
  if (change === null) return "";
  const points = Math.round(Math.abs(change) * 100);
  if (!points) return "";
  return ` · ${change > 0 ? "Dem" : "Rep"} up ${points} ${points === 1 ? "point" : "points"} this week`;
}

/** Two figures, Democrats on the left and Republicans on the right, over a bar split between them. */
function Split({ d, r, dLabel, rLabel, label, caption }: { d: number; r: number; dLabel: string; rLabel: string; label: string; caption: string }) {
  const total = Math.max(1, d + r);
  return (
    <div className="mt-fc-odds">
      <div className="mt-seats-nums">
        <span className="d">
          <b>{dLabel}</b> Dem
        </span>
        <span className="r">
          Rep <b>{rLabel}</b>
        </span>
      </div>
      <div className="mt-balance-bar mt-seats-bar" role="img" aria-label={label}>
        <span style={{ width: `${(d / total) * 100}%`, background: "var(--dem)" }} />
        <span style={{ flex: 1, background: "var(--rep)" }} />
        <i aria-hidden />
      </div>
      <p className="mt-fc-sub">{caption}</p>
    </div>
  );
}

/** Both parties' chance of control over one split bar, with the week's move. */
export function PartyOdds({ dControl, control }: { dControl: number; control: readonly ChartPoint[] }) {
  return (
    <Split
      d={dControl}
      r={1 - dControl}
      dLabel={whole(dControl)}
      rLabel={whole(1 - dControl)}
      label={`Democrats ${whole(dControl)}, Republicans ${whole(1 - dControl)}`}
      caption={`Chance of winning control${weekText(weekChange(control))}`}
    />
  );
}

/** Expected seats for each party, for governorships and before the simulation has run. */
function PartySeats({ view, office }: { view: ChamberView; office: ForecastOffice }) {
  return (
    <Split
      d={view.dSeats}
      r={view.rSeats}
      dLabel={`${view.dSeats}`}
      rLabel={`${view.rSeats}`}
      label={`Democrats ${view.dSeats}, Republicans ${view.rSeats}`}
      caption={`Projected ${office === "governor" ? "governorships" : "seats"}`}
    />
  );
}

/** An office's chance of control, or projected seats for governors and before the simulation has run. */
export function ForecastOdds({ office, view, control }: { office: ForecastOffice; view: ChamberView; control: readonly ChartPoint[] }) {
  return view.dControl !== null ? <PartyOdds dControl={view.dControl} control={control} /> : <PartySeats view={view} office={office} />;
}

/** The numbers under the odds: projected seats, the majority, and governors not up this year. */
function Facts({ view, office }: { view: ChamberView; office: ForecastOffice }) {
  const rows: [string, string][] = [
    ...(view.dControl !== null ? [["Projected seats", `${view.dSeats} D · ${view.rSeats} R`] as [string, string]] : []),
    ...(view.majority ? [["Needed for control", `${view.majority}`] as [string, string]] : []),
    ...(office === "governor" ? [["Governors not up this year", `${view.notUp.D + view.notUp.R + view.notUp.other}`] as [string, string]] : []),
  ];
  if (!rows.length) return null;
  return (
    <dl className="mt-fc-parts">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The top of a forecast page: the headline, each party's chance (or projected seats for governors) beside a chart
 * that switches between chance of control and seat count over time.
 */
export function ForecastHero({ office, view, control, seats, controls, action, marker }: {
  office: ForecastOffice;
  view: ChamberView;
  /** Democrats' chance of control by day. */
  control: readonly ChartPoint[];
  /** Expected seats by day. */
  seats: { D: readonly ChartPoint[]; R: readonly ChartPoint[] };
  /** Controls at the right of the headline (the overview's chamber switch). */
  controls?: ReactNode;
  /** A link under the numbers (the overview's "Full forecast"). */
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
  const unit = office === "governor" ? "governorships" : "seats";
  return (
    <section className="mt-fc-hero">
      <div className="mt-fc-hero-head">
        <h2 className="mt-fc-head">
          {parts.map((p, i) => (
            <span key={i} className={`t-${p.tone}`}>
              {i > 0 && " "}
              {p.text}
            </span>
          ))}
        </h2>
        {controls}
      </div>
      <div className="mt-fc-hero-body">
        <div className="mt-fc-hero-side">
          <ForecastOdds office={office} view={view} control={control} />
          <Facts view={view} office={office} />
          {action}
        </div>
        <div className="mt-fc-hero-chart" ref={chartBox}>
          <div className="mt-section-head tight">
            <span className="mt-fc-label">{showing === "win" ? "Chance of control over time" : `Projected ${unit} over time`}</span>
            {hasControl && (
              <div className="mt-seg" role="group" aria-label="Chart shows">
                <button type="button" aria-pressed={showing === "win"} onClick={() => setTab("win")}>Chance</button>
                <button type="button" aria-pressed={showing === "seats"} onClick={() => setTab("seats")}>Seats</button>
              </div>
            )}
          </div>
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
              label={`Projected ${unit} over time`}
              empty="The chart fills in as the forecast records each day's projected seats."
              marker={marker ?? undefined}
              size={chartSize}
            />
          )}
          {marker && (
            <p className="mt-fc-note">
              Days before {marker.label.replace("Markets added ", "")} were recomputed from polls and fundamentals alone; prediction markets joined the
              forecast that day, so the step there is the new input, not an overnight swing.
            </p>
          )}
        </div>
      </div>
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
    <section className="mt-seats mt-fc-seats">
      <div className="mt-seats-nums">
        <span className="d">
          <b>{view.dSeats}</b> Dem
        </span>
        <span className="mt-legend mt-fc-legend">
          {(["safe", "likely", "lean"] as const).map((t) => (
            <span key={t}>
              <i style={{ background: `linear-gradient(135deg, var(--rate-${t}-d) 50%, var(--rate-${t}-r) 50%)` }} /> {t[0].toUpperCase() + t.slice(1)}
            </span>
          ))}
          <span>
            <i style={{ background: "var(--rate-tossup)" }} /> Toss-up
          </span>
        </span>
        <span className="r">
          Rep <b>{view.rSeats}</b>
        </span>
      </div>
      <div className="mt-fc-seatbar" role="img" aria-label={RATING_KEYS.map((k) => `${RATING_TEXT[k]} ${view.ratings[k]}`).join(", ")}>
        {RATING_KEYS.slice(0, 4).map((k) => view.ratings[k] > 0 && <span key={k} className={k === "tossup" ? "dark" : undefined} style={{ width: `${(view.ratings[k] / total) * 100}%`, background: RATING_VAR[k] }} title={`${RATING_TEXT[k]}: ${view.ratings[k]}`}>{label(view.ratings[k])}</span>)}
        {view.ratings.other > 0 && <span style={{ width: `${(view.ratings.other / total) * 100}%`, background: "var(--oth)" }} title={`Independent or no forecast: ${view.ratings.other}`}>{label(view.ratings.other)}</span>}
        {RATING_KEYS.slice(4).map((k) => view.ratings[k] > 0 && <span key={k} style={{ width: `${(view.ratings[k] / total) * 100}%`, background: RATING_VAR[k] }} title={`${RATING_TEXT[k]}: ${view.ratings[k]}`}>{label(view.ratings[k])}</span>)}
        {view.majority && <i className="mt-fc-majority" style={{ left: `${(view.majority / total) * 100}%` }} />}
      </div>
      <p className="muted small">
        {view.majority
          ? `Seats by forecast rating, Democrats from the left. The line marks ${view.majority} for control.`
          : office === "governor"
            ? `Governorships by forecast rating, Democrats from the left. Includes the ${view.notUp.D + view.notUp.R + view.notUp.other} governors not up this year.`
            : "Seats by forecast rating, Democrats from the left."}
      </p>
    </section>
  );
}
