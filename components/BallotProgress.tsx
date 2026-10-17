"use client";

import { useEffect, useState } from "react";
import type { Ballot } from "@/lib/ballot/store";
import type { GuideSummary } from "@/lib/guides";

/** One contest's share of the work: the race lookup is a fifth, each candidate an equal part of the rest. */
export function contestProgress(g: GuideSummary): number {
  if (g.status === "ready" || g.status === "failed") return 1;
  if (g.status === "queued") return 0;
  if (!g.candidateCount) return 0.1;
  return 0.2 + 0.8 * Math.min(1, g.candidatesDone / g.candidateCount);
}

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const districtList = (b: Ballot) =>
  [b.districts.congressional, b.districts.stateSenate, b.districts.stateHouse, b.districts.county, b.districts.place, b.districts.schoolDistrict].filter(
    (d): d is string => Boolean(d),
  );

function Step({ state, title, children }: { state: "done" | "active" | "todo"; title: string; children?: React.ReactNode }) {
  return (
    <li className={`step ${state}`}>
      <span className={state === "active" ? "spinner" : state === "done" ? "done-dot" : "todo-dot"} aria-hidden />
      <div>
        <div className="label">{title}</div>
        {children}
      </div>
    </li>
  );
}

export function BallotProgress({ ballot, guides }: { ballot: Ballot; guides: GuideSummary[] }) {
  const finding = ballot.status === "finding";
  const working = finding || guides.some((g) => g.status === "queued" || g.status === "researching");
  const now = useNow(working);
  if (!working) return null;

  const units = guides.reduce((sum, g) => sum + contestProgress(g), 0);
  const contestShare = guides.length ? units / guides.length : 0;
  // Finding contests is the first tenth of the bar; it creeps forward with each search so it never looks stuck.
  const percent = finding ? Math.min(9, 2 + ballot.searches) : Math.round(10 + 90 * contestShare);
  const ready = guides.filter((g) => g.status === "ready" || g.status === "failed").length;

  // Time left from this run's own pace, once enough contests have finished to judge it.
  const researchStart = finding ? null : ballot.updatedAt;
  let estimate: string | null = null;
  if (researchStart && contestShare >= 0.15 && contestShare < 1) {
    const perUnit = (now - researchStart) / contestShare;
    const minutes = Math.ceil((perUnit * (1 - contestShare)) / 60_000);
    estimate = minutes <= 1 ? "About a minute left" : `About ${minutes} minutes left`;
  }

  return (
    <section className="ballot-progress panel" aria-live="polite" aria-label="Research progress">
      <div className="bp-head">
        <h2>{finding ? "Building your ballot" : "Looking up your races"}</h2>
        <span className="bp-percent">{percent}%</span>
      </div>
      <div className="bp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="small muted">
        {finding
          ? `Finding the races on your ballot (${clock(now - (ballot.startedAt ?? now))} so far).`
          : `${ready} of ${guides.length} races ready.${estimate ? ` ${estimate}.` : ""}`}{" "}
        You can close this page. We&apos;ll keep working.
      </p>
      <ol className="steps">
        <Step state="done" title="Found your districts">
          <div className="chips">{districtList(ballot).map((d) => <span key={d} className="district">{d}</span>)}</div>
        </Step>
        <Step state={finding ? "active" : "done"} title={finding ? "Finding the races on your ballot" : `Found ${guides.length} races`}>
          {finding && (
            <div className="detail">
              {ballot.activity ?? "Starting the search"}
              {ballot.searches > 0 && <span className="muted"> ({ballot.searches} searches so far)</span>}
            </div>
          )}
        </Step>
        <Step state={finding ? "todo" : "active"} title="Looking up every candidate" />
      </ol>
    </section>
  );
}
