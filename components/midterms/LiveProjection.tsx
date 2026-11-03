"use client";
// The companion screen's main area: each chamber's projected final seats and chance of control, worked out in the
// browser from the results this screen shows (a mock night's, or Decision Desk HQ's when connected) with every fetch:
// the forecast plus the night's calls and counts (lib/midterms/liveProjection.ts). The undecided races nearest a coin
// flip fill the rest of each column.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { Body, Side } from "@/lib/midterms/forecast";
import type { ChamberProjection, LiveProjection as Projection, RaceOutlook } from "@/lib/midterms/liveProjection";
import { raceLabel, type RaceSummary } from "@/lib/midterms/view";
import { lastName } from "./CandidateTable";

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

function Control({ office, view }: { office: Body; view: ChamberProjection }) {
  const d = view.dControl;
  const side = d >= 0.5 ? "D" : "R";
  const p = side === "D" ? d : 1 - d;
  return (
    <p className={`mt-proj-control ${side === "D" ? "d" : "r"}`}>
      <b>{PARTY[side]}</b> {pct(p)} {office === "governor" ? "to hold most governorships" : "to control"}
    </p>
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

function RaceRow({ race }: { race: RaceOutlook }) {
  const count =
    race.leader && race.margin !== null
      ? `${lastName(race.leader)} +${race.margin.toFixed(1)} · ${race.reportingUnknown ? "counting" : `${Math.round(race.reporting)}% in`}`
      : "No votes yet";
  return (
    <li>
      <span className="mt-proj-race">{raceLabel(race)}</span>
      <span className="mt-proj-count">{count}</span>
      <span className={`mt-proj-chance ${race.side === "R" ? "r" : "d"}`}>
        {race.side === "I" ? "IND" : race.side === "D" ? "DEM" : "GOP"} {pct(race.chance)}
      </span>
    </li>
  );
}

function Chamber({ office, view }: { office: Body; view: ChamberProjection }) {
  const list = useFitRows();
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
      <Control office={office} view={view} />
      <p className="mt-proj-tally muted small">
        Won {view.won.D} D · {view.won.R} R · {view.counting} counting · {view.waiting} no votes yet
        {office !== "house" && ` · ${view.notUp.D + view.notUp.R + view.notUp.other} not up`}
      </p>
      <h4>Deciding races</h4>
      <ol ref={list} className="mt-proj-races">
        {view.close.map((r) => (
          <RaceRow key={r.id} race={r} />
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
function useProjection(races: readonly RaceSummary[]): Projection | null {
  const [projection, setProjection] = useState<Projection | null>(null);
  useEffect(() => {
    let live = true;
    import("@/lib/midterms/liveProjection").then(({ projectChambers }) => {
      if (live) setProjection(projectChambers(races));
    });
    return () => {
      live = false;
    };
  }, [races]);
  return projection;
}

/** The companion's live projection of each chamber, filling its window. */
export function LiveProjection({ races }: { races: readonly RaceSummary[] }) {
  const data = useProjection(races);
  return (
    <section className="mt-proj" aria-label="Live projection">
      <div className="mt-section-head tight">
        <h2>Live projection</h2>
        <span className="muted small">{data ? swingText(data.swing) : "Working it out…"} · forecast, adjusted for calls and counts</span>
      </div>
      {data && (
        <div className="mt-proj-cols">
          {(["senate", "house", "governor"] as const).map((o) => (
            <Chamber key={o} office={o} view={data.chambers[o]} />
          ))}
        </div>
      )}
    </section>
  );
}
