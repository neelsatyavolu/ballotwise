"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { stampET, stateFinal } from "@/lib/midterms/polls";
import type { Observation } from "@/lib/midterms/history";
import type { RaceDetail } from "@/lib/midterms/races";
import { colorOf, fmt, OFFICE_LABEL, partyTag, pct, raceLabel, signalLine, STATE_NAMES, timeAgo } from "@/lib/midterms/view";
import { CountyTip, fillFor, type Mode } from "./county";
import { CountyTable } from "./CountyTable";
import { useLive, useStars } from "./hooks";
import { CountyMap, type CountyFill } from "./maps";
import { ModeNav } from "./ModeNav";
import { RatingTag, StarButton } from "./RaceCard";
import { CountingContext, RaceStatus, VoteUpdates } from "./RaceContext";

type Fetched = { race: RaceDetail; fetchedAt: number; stale: boolean; history?: Observation[]; callPending?: boolean };
const SCREEN = { senate: "/midterms/senate", house: "/midterms/house", governor: "/midterms/governor", measure: "/midterms/measures" } as const;

export function RaceView({ id }: { id: number }) {
  const { data, error, now } = useLive<Fetched>(`/api/midterms/race/${id}`);
  const favorites = useStars();
  const [mode, setMode] = useState<Mode>("results");
  const [selected, setSelected] = useState<string | null>(null);
  const race = data?.race;

  const fills = useMemo(() => {
    const out = new Map<string, CountyFill>();
    for (const c of race?.counties ?? []) if (c.fips) out.set(c.fips, { fill: fillFor(c, mode), tip: <CountyTip county={c} mode={mode} />, active: true });
    return out;
  }, [race, mode]);

  if (!race) {
    return (
      <div className="wrap mt">
        {error ? <p className="error">{error}</p> : <p className="muted">Loading results…</p>}
      </div>
    );
  }

  const label = raceLabel(race);
  const mapped = race.counties.some((c) => c.fips);
  const called = race.candidates.find((c) => c.winner);
  const close = race.pollsClose ? new Date(race.pollsClose) : null;

  return (
    <div className="wrap mt">
      <ModeNav current={SCREEN[race.office]} />
      <nav className="mt-crumbs small" aria-label="Breadcrumb">
        <Link href="/midterms">Midterms 2026</Link> › <Link href={`${SCREEN[race.office]}?state=${race.state}`}>{STATE_NAMES[race.state] ?? race.state}</Link> › {OFFICE_LABEL[race.office]}
      </nav>
      <header className="mt-race-head">
        <div className="mt-race-title">
          <h1>{label}</h1>
          <RatingTag rating={race.rating} signal={race.signal} />
          {favorites.ids !== null && <StarButton starred={favorites.ids.includes(race.id)} label={label} onToggle={() => favorites.toggle(race.id)} />}
        </div>
        {race.about && (
          <p className="mt-race-about">
            {race.about.text}.{" "}
            {race.about.url && (
              <a href={race.about.url} className="small">
                Summary from Ballotpedia
              </a>
            )}
          </p>
        )}
        {race.office === "measure" && <p className="muted small">{race.title}</p>}
        {signalLine(race.signal) && (
          <p className="mt-meta small">
            <span>
              Forecast · {signalLine(race.signal)}
              {race.signal?.market && ` (${race.signal.market.sources.join(" and ")})`}
              {race.signal?.polls && `, polls through ${race.signal.polls.latest}`}
            </span>
          </p>
        )}
        <RaceStatus race={race} now={now} />
        {data.callPending && <p className="muted small">The call status is catching up with the latest count; it will settle on the next update.</p>}
        <p className="mt-meta small">
          <span>{race.total > 0 ? (race.reportingUnknown ? "Reporting unknown" : `${Math.round(race.reporting)}% reporting`) : "No results yet"}</span>
          {close && close.getTime() !== stateFinal(race.state) && <span title="civicAPI's closing time for this race, which differs from the state's last scheduled closing">civicAPI lists polls closing {stampET(close.getTime())} ET</span>}
          <span>
            Checked {timeAgo(data.fetchedAt, now)}
            {data.stale && " (results source is slow; showing the last good count)"}
          </span>
        </p>
        {error && <p className="error small">{error} Showing the last results we got.</p>}
        {favorites.error && <p className="error small">{favorites.error}</p>}
      </header>

      <div className="mt-race-grid">
        <section aria-labelledby="cands">
          <h2 id="cands">Candidates</h2>
          <table className="mt-table mt-cands">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Party</th>
                <th className="num">Votes</th>
                <th className="num">Share</th>
              </tr>
            </thead>
            <tbody>
              {race.candidates.map((c) => (
                <tr key={c.name} className={c.winner ? "won" : undefined}>
                  <td style={{ boxShadow: `inset 4px 0 0 ${colorOf(c)}` }}>
                    {c.name}
                    {c.incumbent && <span title="Incumbent">*</span>}
                    {c.winner && <span className="mt-check"> ✓ Winner</span>}
                  </td>
                  <td>{partyTag(c.party) || c.party || "—"}</td>
                  <td className="num">{fmt(c.votes)}</td>
                  <td className="num">
                    <span className="mt-share">
                      <span style={{ width: `${c.pct}%`, background: colorOf(c) }} />
                    </span>
                    {pct(c.pct)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Total</td>
                <td className="num">{fmt(race.total)}</td>
                <td className="num">{race.reportingUnknown ? "Reporting unknown" : `${Math.round(race.reporting)}% reporting`}</td>
              </tr>
            </tfoot>
          </table>
          <p className="muted small mt-source">
            {called ? `${called.name} was declared the winner by civicAPI's decision desk, not AP or Decision Desk HQ. ` : "No winner declared yet. "}
            Results from <a href="https://civicapi.org">civicAPI</a>, which collects them from state and county election offices. * Incumbent.
          </p>
          {race.total > 0 && <CountingContext race={race} fetchedAt={data.fetchedAt} />}
          {data.history && <VoteUpdates history={data.history} />}
        </section>

        <section aria-labelledby="map">
          <div className="mt-section-head">
            <h2 id="map">Counties</h2>
            {mapped && (
              <div className="mt-seg" role="group" aria-label="Map shows">
                {(["results", "reporting", "2024"] as const).map((m) => (
                  <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
                    {m === "results" ? "Leader" : m === "reporting" ? "Reporting" : "2024 president"}
                  </button>
                ))}
              </div>
            )}
          </div>
          {mapped ? (
            <CountyMap state={race.state} fills={fills} selected={selected} onSelect={setSelected} />
          ) : (
            <p className="muted small">
              {race.counties.length > 1 ? `${STATE_NAMES[race.state] ?? race.state} reports by town, so there's no county map. Every town is in the table below.` : "This state reports one statewide total, so there's no county map."}
            </p>
          )}
          {mapped && race.office === "house" && <p className="muted small">Shaded counties are all or partly in this district.</p>}
        </section>
      </div>

      {race.counties.length > 1 && <CountyTable race={race} selected={selected} onSelect={setSelected} />}
    </div>
  );
}
