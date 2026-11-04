"use client";
// The companion screen's main area: each chamber's projected final seats and chance of control, worked out in the
// browser from the results this screen shows (a mock night's, or Decision Desk HQ's when connected) with every fetch:
// the forecast plus the night's calls and counts (lib/midterms/liveProjection.ts), combined with DDHQ Pulse where it's
// up. The undecided races nearest a coin flip fill the rest of each column.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { Pulse, PulseChamberName, PulsePoint, PulseRace } from "@/lib/ddhq/pulse";
import type { Body, Side } from "@/lib/midterms/forecast";
import type { ChamberProjection, LiveProjection as Projection, RaceOutlook } from "@/lib/midterms/liveProjection";
import { chamberCall } from "@/lib/midterms/moments";
import { stampTime } from "@/lib/midterms/polls";
import { raceKey } from "@/lib/midterms/seats";
import { raceLabel, type RaceSummary } from "@/lib/midterms/view";
import { lastName } from "./CandidateTable";
import { usePulse } from "./usePulse";

const TITLE: Record<Body, string> = { senate: "Senate", house: "House", governor: "Governors" };
const SEATS: Record<Body, number> = { senate: 100, house: 435, governor: 50 };
const PARTY: Record<Side, string> = { D: "Democrats", R: "Republicans", I: "Independent" };
/** A race's forecast σ in points, for turning the national read into points (DEFAULT_SIGMA in liveProjection.ts). */
const SIGMA_PTS = 8;

const pct = (p: number) => (p > 0.99 ? ">99%" : p < 0.01 ? "<1%" : `${Math.round(p * 100)}%`);

/** Hides every race row from the first that runs past the bottom of its list, so each list ends on a whole row. */
function fitRows(box: HTMLElement) {
  const bottom = box.getBoundingClientRect().bottom;
  const rows = [...box.querySelectorAll<HTMLElement>("li")];
  rows.forEach((r) => (r.hidden = false));
  const first = rows.findIndex((r) => r.getBoundingClientRect().bottom > bottom + 1);
  if (first >= 0) rows.slice(first).forEach((r) => (r.hidden = true));
}

function useFitRows() {
  const box = useRef<HTMLOListElement>(null);
  useLayoutEffect(() => {
    if (box.current) fitRows(box.current);
  });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const watch = new ResizeObserver(() => fitRows(el));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return box;
}

function Control({ office, view, pulse }: { office: Body; view: ChamberProjection; pulse: Pulse | null }) {
  // Once a party has won control (or Decision Desk HQ has called the chamber), that replaces the chance.
  const call = office === "governor" ? null : chamberCall(office, { D: view.notUp.D + view.won.D, R: view.notUp.R + view.won.R }, pulse?.calls?.[office]);
  if (call) {
    return (
      <p className={`mt-proj-control ${call.side === "D" ? "d" : "r"}`}>
        <b>✓ {call.text}</b>
        {call.by && " (DDHQ)"}
      </p>
    );
  }
  const d = view.dControl;
  const side = d >= 0.5 ? "D" : "R";
  const p = side === "D" ? d : 1 - d;
  return (
    <p className={`mt-proj-control ${side === "D" ? "d" : "r"}`}>
      <b>{PARTY[side]}</b> {pct(p)} {office === "governor" ? "to hold most governorships" : "to control"}
    </p>
  );
}

/** The two chances the control line combines: ours, and DDHQ Pulse's (Decision Desk HQ's live model). */
function PulseControl({ view, own }: { view: ChamberProjection; own: { dSeats: number; rSeats: number } | null }) {
  const side = (d: number) => (d >= 0.5 ? <b className="d">D {pct(d)}</b> : <b className="r">R {pct(1 - d)}</b>);
  // With DDHQ Pulse's projected seats in hand, the column is Pulse's projection and ours is set beside it.
  if (own) {
    return (
      <p className="mt-proj-pulse small" title="Seats and chance of control from DDHQ Pulse, Decision Desk HQ's live model; ours is beside it for comparison.">
        DDHQ Pulse projection · ours {own.dSeats}–{own.rSeats}, {side(view.ours)}
      </p>
    );
  }
  return (
    <p className="mt-proj-pulse small" title="The chance above combines ours and DDHQ Pulse's equally (on the probit scale). Pulse is Decision Desk HQ's live model of who controls the chamber.">
      Ours {side(view.ours)} · DDHQ Pulse {view.pulse !== null && side(view.pulse)}
    </p>
  );
}

/** The chart's drawing box: a wide, short line, stretched to the column's width. */
const CHART_W = 300;
const CHART_H = 40;

/**
 * The chamber's Pulse over the day: the Democrats' chance of control (blue) and the Republicans' (red), each value
 * carried forward to the next change and to the latest read, with 50% marked. Nothing until there are two points.
 */
function PulseChart({ office, history, at }: { office: PulseChamberName; history: readonly PulsePoint[]; at: number | null }) {
  const points = history.flatMap((p) => (p[office] === undefined ? [] : [{ at: p.at, dem: p[office] }]));
  if (points.length < 2) return null;
  const start = points[0].at;
  const end = Math.max(at ?? 0, points[points.length - 1].at);
  const x = (t: number) => ((t - start) / Math.max(1, end - start)) * CHART_W;
  const y = (pct: number) => CHART_H - (pct / 100) * CHART_H;
  const line = (value: (dem: number) => number) =>
    points.map((p, i) => `${i ? `H${x(p.at).toFixed(1)}V` : `M0 `}${y(value(p.dem)).toFixed(1)}`).join("") + `H${CHART_W}`;
  return (
    <figure className="mt-proj-chart" aria-label={`DDHQ Pulse since ${stampTime(start)}`}>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" aria-hidden>
        <line className="mid" x1="0" x2={CHART_W} y1={CHART_H / 2} y2={CHART_H / 2} />
        <path className="r" d={line((dem) => 100 - dem)} />
        <path className="d" d={line((dem) => dem)} />
      </svg>
      <figcaption className="muted">
        <span>{stampTime(start)}</span>
        <span>now</span>
      </figcaption>
    </figure>
  );
}

/** Seats held or won (solid), then the rest each side is projected to take (light), from either end of the bar. */
function SeatBar({ office, view }: { office: Body; view: ChamberProjection }) {
  const total = SEATS[office];
  const heldD = view.notUp.D + view.won.D;
  const heldR = view.notUp.R + view.won.R;
  const w = (n: number) => `${(Math.max(0, n) / total) * 100}%`;
  return (
    <div className="mt-proj-bar" aria-hidden style={{ "--majority": `${(view.majority / total) * 100}%` } as CSSProperties}>
      <span className="d" style={{ width: w(heldD) }} />
      <span className="d soft" style={{ width: w(view.dSeats - heldD) }} />
      <span className="gap" />
      <span className="r soft" style={{ width: w(view.rSeats - heldR) }} />
      <span className="r" style={{ width: w(heldR) }} />
    </div>
  );
}

function RaceRow({ race, pulse }: { race: RaceOutlook; pulse: PulseRace | null }) {
  const count =
    race.leader && race.margin !== null
      ? `${lastName(race.leader)} +${race.margin.toFixed(1)} · ${race.reportingUnknown ? "counting" : `${Math.round(race.reporting)}% in`}`
      : "No votes yet";
  return (
    <li>
      <span className="mt-proj-race">{raceLabel(race)}</span>
      <span className="mt-proj-count">
        {count}
        {pulse && (
          <span title={`DDHQ Pulse, Decision Desk HQ's live model: ${pulse.name} ${Math.round(pulse.chance)}% to win`}>
            {" · Pulse "}
            <b className={pulse.side === "R" ? "r" : "d"}>{pulse.side} {Math.round(pulse.chance)}%</b>
          </span>
        )}
      </span>
      <span className={`mt-proj-chance ${race.side === "R" ? "r" : "d"}`}>
        {race.side === "I" ? "IND" : race.side === "D" ? "DEM" : "GOP"} {pct(race.chance)}
      </span>
    </li>
  );
}

function Chamber({ office, view: ours, pulse }: { office: Body; view: ChamberProjection; pulse: Pulse | null }) {
  const list = useFitRows();
  // DDHQ Pulse's projection, where it's up, is the chamber's projection: its projected seats and its chance of control.
  const projected = office === "governor" ? undefined : pulse?.projected?.[office];
  const chance = office === "governor" ? undefined : pulse?.chambers[office];
  const view = projected ? { ...ours, dSeats: projected.dem, rSeats: projected.rep, dControl: chance ? chance.dem / 100 : ours.dControl } : ours;
  return (
    <section className="mt-proj-col" aria-label={`${TITLE[office]} projection`}>
      <h3>{TITLE[office]}</h3>
      <div className="mt-proj-seats">
        <span className="d">
          <b>{view.dSeats}</b> Dem
        </span>
        <span className="r">
          Rep <b>{view.rSeats}</b>
        </span>
      </div>
      <SeatBar office={office} view={view} />
      <Control office={office} view={view} pulse={pulse} />
      {view.pulse !== null && <PulseControl view={view} own={projected ? { dSeats: ours.dSeats, rSeats: ours.rSeats } : null} />}
      {pulse && office !== "governor" && <PulseChart office={office} history={pulse.history ?? []} at={pulse.at} />}
      <p className="mt-proj-tally muted small">
        Won {view.won.D} D · {view.won.R} R · {view.counting} counting · {view.waiting} no votes yet
        {office !== "house" && ` · ${view.notUp.D + view.notUp.R + view.notUp.other} not up`}
      </p>
      <h4>Deciding races</h4>
      <ol ref={list} className="mt-proj-races">
        {view.close.map((r) => (
          <RaceRow key={r.id} race={r} pulse={pulse?.races[raceKey(r.office, r.state, r.district)] ?? null} />
        ))}
      </ol>
    </section>
  );
}

/** The national read in words, once counted races have moved it at least half a point. */
function swingText(swing: number): string | null {
  const pts = swing * SIGMA_PTS;
  if (Math.abs(pts) < 0.5) return "Counted races are running close to the forecast";
  return `${pts > 0 ? "Democrats" : "Republicans"} running ${Math.abs(pts).toFixed(1)} pts ahead of the forecast in well-counted races`;
}

/**
 * Each chamber's projection for `races`, redone whenever they change. The model (and the simulation's fitted
 * parameters) loads only here, so other pages never download it.
 */
function useProjection(races: readonly RaceSummary[], pulse: Pulse | null): Projection | null {
  const [projection, setProjection] = useState<Projection | null>(null);
  useEffect(() => {
    let live = true;
    import("@/lib/midterms/liveProjection").then(({ projectChambers }) => {
      // DDHQ Pulse, where it's up, is combined with ours race by race and for each chamber's control.
      if (live) setProjection(projectChambers(races, undefined, pulse?.at ? pulse : undefined));
    });
    return () => {
      live = false;
    };
  }, [races, pulse]);
  return projection;
}

/** The companion's live projection of each chamber, filling its window. */
export function LiveProjection({ races }: { races: readonly RaceSummary[] }) {
  const pulse = usePulse();
  const data = useProjection(races, pulse);
  return (
    <section className="mt-proj" aria-label="Live projection">
      <div className="mt-section-head tight">
        <h2>Live projection</h2>
        <span className="muted small">{data ? swingText(data.swing) : "Working it out…"} · {pulse?.projected?.house || pulse?.projected?.senate ? "Senate and House from DDHQ Pulse's projection; governors from ours" : `forecast, adjusted for calls and counts${pulse?.at ? ", combined with DDHQ Pulse" : ""}`}</span>
      </div>
      {data && (
        <div className="mt-proj-cols">
          {(["senate", "house", "governor"] as const).map((o) => (
            <Chamber key={o} office={o} view={data.chambers[o]} pulse={pulse} />
          ))}
        </div>
      )}
    </section>
  );
}
