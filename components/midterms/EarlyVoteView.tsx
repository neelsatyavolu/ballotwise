"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { shareOf2024, type EarlyNation, type EarlyState, type EarlyStateDetail } from "@/lib/midterms/earlyVote";
import { fmt, pct, STATE_NAMES } from "@/lib/midterms/view";
import { dayLabel, PartyBar, partyLead, StatePanel, Stats, TurnoutLegend, turnoutFill } from "./EarlyVoteState";
import { useLive } from "./hooks";
import { ModeNav } from "./ModeNav";
import { OfficeSkeleton } from "./Skeleton";
import { ZoomMap, type Fill } from "./ZoomMap";

function StateTip({ s }: { s: EarlyState }) {
  const share = shareOf2024(s.cast, s.base2024);
  return (
    <div className="mt-ev-tip">
      <b>{STATE_NAMES[s.state]}</b>
      <span>{fmt(s.cast)} ballots cast{share !== null && ` · ${pct(share)} of the 2024 vote`}</span>
      <span className="muted">
        Mail {fmt(s.returned)} · in person {fmt(s.inperson)}
        {s.party && ` · registration ${partyLead(s.party)}`}
      </span>
    </div>
  );
}

function StateRows({ states, onPick }: { states: EarlyState[]; onPick: (state: string) => void }) {
  return (
    <div className="mt-rows-wrap">
      <table className="mt-table mt-ev-rows pick">
        <thead>
          <tr>
            <th>State</th>
            <th className="num">Ballots</th>
            <th className="num">Of 2024</th>
            <th className="num">Reg. lead</th>
          </tr>
        </thead>
        <tbody>
          {states.map((s) => {
            const share = shareOf2024(s.cast, s.base2024);
            return (
              <tr key={s.state} onClick={() => onPick(s.state)}>
                <td>
                  <button type="button" className="mt-ev-pick" onClick={() => onPick(s.state)}>
                    {STATE_NAMES[s.state]}
                  </button>
                </td>
                <td className="num">{fmt(s.cast)}</td>
                <td className="num">{share === null ? "—" : pct(share)}</td>
                <td className="num">{s.party ? partyLead(s.party) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The nation's totals and the registration split across the states that report one. */
function NationSummary({ states }: { states: EarlyState[] }) {
  const counts = states.reduce((t, s) => ({ requested: t.requested + s.requested, returned: t.returned + s.returned, inperson: t.inperson + s.inperson, cast: t.cast + s.cast }), { requested: 0, returned: 0, inperson: 0, cast: 0 });
  const withParty = states.filter((s) => s.party);
  const party = withParty.length ? withParty.reduce((t, s) => ({ dem: t.dem + s.party!.dem, rep: t.rep + s.party!.rep, other: t.other + s.party!.other }), { dem: 0, rep: 0, other: 0 }) : null;
  return (
    <section className="mt-ev-summary mt-in" aria-label="Across the country">
      <Stats counts={{ ...counts, party: null }} />
      {party && (
        <div>
          <p className="small">
            In the {withParty.length} states that record party registration ({fmt(withParty.reduce((n, s) => n + s.cast, 0))} ballots):
          </p>
          <PartyBar party={party} />
        </div>
      )}
    </section>
  );
}

/**
 * The Early vote tab: ballots cast before Election Day, by state and county, from civicAPI's tracker. The map shades
 * each state by how much of its 2024 vote has already come in; picking one shows its counties, party registration,
 * demographics and the same day in 2024. The picked state lives in the URL.
 */
export function EarlyVoteView({ initialState }: { initialState: string | null }) {
  const nation = useLive<EarlyNation>("/api/midterms/early-vote");
  const [focus, setFocus] = useState<string | null>(initialState);
  const [query, setQuery] = useState("");
  const detail = useLive<EarlyStateDetail>(focus ? `/api/midterms/early-vote/${focus}` : null);
  const shown = detail.data?.state === focus ? detail.data : null;

  useEffect(() => {
    const url = new URL(window.location.href);
    if (focus) url.searchParams.set("state", focus);
    else url.searchParams.delete("state");
    window.history.replaceState(window.history.state, "", url);
  }, [focus]);

  const states = useMemo(() => nation.data?.states ?? [], [nation.data]);
  const fills = useMemo(() => new Map<string, Fill>(states.map((s) => [s.state, { fill: turnoutFill(shareOf2024(s.cast, s.base2024)), tip: <StateTip s={s} /> }])), [states]);
  // Undefined while the state loads, so the map holds its view; empty when its places aren't counties.
  const countyFills = useMemo(() => {
    if (!focus) return null;
    if (!shown) return detail.error ? null : undefined;
    const out = new Map<string, Fill>();
    for (const c of shown.counties) {
      if (!c.fips) continue;
      const share = shareOf2024(c.cast, c.base2024);
      out.set(c.fips, {
        fill: turnoutFill(share),
        tip: (
          <div className="mt-ev-tip">
            <b>{c.name}</b>
            <span>{fmt(c.cast)} ballots cast{share !== null && ` · ${pct(share)} of the 2024 vote`}</span>
            {c.party && <span className="muted">Registration {partyLead(c.party)}</span>}
          </div>
        ),
      });
    }
    return out;
  }, [focus, shown, detail.error]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return states.filter((s) => !q || `${STATE_NAMES[s.state]} ${s.state}`.toLowerCase().includes(q));
  }, [states, query]);
  const total = states.reduce((n, s) => n + s.cast, 0);
  const statesWithParty = states.filter((s) => s.party).length;

  return (
    <div className="wrap mt mt-office-page mt-ev-page">
      <ModeNav current="/midterms/early-vote" />
      <header className="mt-hero">
        <h1>Early vote</h1>
        <span className="mt-kicker">{nation.data ? `${fmt(total)} ballots cast in ${states.length} states` : ""}</span>
        {nation.data?.asOf && <span className="mt-updated small">Counts as of {dayLabel(nation.data.asOf)}</span>}
      </header>
      {nation.error && <p className="error">{nation.data ? `${nation.error} Showing the last counts we got.` : nation.error}</p>}
      {!nation.data && !nation.error && <OfficeSkeleton />}

      {nation.data && (
        <>
          <NationSummary states={states} />
          <div className="mt-office mt-in">
            <div>
              <ZoomMap fills={fills} focus={focus} onFocus={setFocus} countyFills={countyFills} raceId={null} label={`Map of early votes cast as a share of the 2024 vote${focus ? `, zoomed to ${STATE_NAMES[focus]}` : ""}`} />
              <TurnoutLegend />
            </div>

            <aside className="mt-panel" aria-label={focus ? `${STATE_NAMES[focus]} early vote` : "Early vote by state"}>
              {!focus ? (
                <>
                  <div className="mt-section-head tight">
                    <h2>By state</h2>
                    <input className="input mt-search" type="search" placeholder="Find a state" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a state" />
                  </div>
                  <StateRows states={list} onPick={setFocus} />
                  <p className="muted small">
                    Tap a state for its counties, party registration and who has voted. Reg. lead is registered Democrats&apos; share of ballots minus Republicans&apos;, in the {statesWithParty} states that record it.
                  </p>
                </>
              ) : (
                <>
                  <div className="mt-section-head tight">
                    <h2>{STATE_NAMES[focus] ?? focus}</h2>
                    <button type="button" className="btn quiet" onClick={() => setFocus(null)}>
                      ← All states
                    </button>
                  </div>
                  {shown ? (
                    <>
                      {shown.asOf && <p className="muted small">Counts as of {dayLabel(shown.asOf)}.{shown.byTown && " This state reports by town, so the map shows it whole."}</p>}
                      <StatePanel detail={shown} />
                    </>
                  ) : detail.error ? (
                    <p className="mt-empty small">{detail.error}</p>
                  ) : (
                    <div className="mt-skel-rows" aria-hidden>
                      {Array.from({ length: 6 }, (_, i) => (
                        <span key={i} className="mt-skel" style={{ height: 18, width: `${92 - (i % 3) * 12}%` }} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </aside>
          </div>
          <p className="muted small mt-source">
            Counts from <a href="https://civicapi.org/early-vote">civicAPI</a>, compiled from state and county election offices, which each report on their own schedule. These are ballots, not results: no votes are counted
            until polls close. <Link href="/midterms/credits">Sources and credits</Link>
          </p>
        </>
      )}
    </div>
  );
}
