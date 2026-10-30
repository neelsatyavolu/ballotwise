"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { stampET, stateFinal } from "@/lib/midterms/polls";
import type { Observation } from "@/lib/midterms/history";
import type { RaceDetail } from "@/lib/midterms/races";
import { OFFICE_LABEL, raceLabel, signalLine, STATE_NAMES } from "@/lib/midterms/view";
import { CandidateTable } from "./CandidateTable";
import { CountyTip, fillFor, type Mode } from "./county";
import { CountyTable } from "./CountyTable";
import { useLive, useStars } from "./hooks";
import { CountyMap, type CountyFill } from "./maps";
import { MarketPanel } from "./MarketPanel";
import { RaceInsights } from "./RaceInsights";
import { ModeNav } from "./ModeNav";
import { RatingTag, StarButton } from "./RaceCard";
import { CountingContext, RaceStatus, TurnoutLine, VoteUpdates } from "./RaceContext";
import { CheckedAgo } from "./CheckedAgo";
import { reportingText } from "./reporting";
import { RcvFlag } from "./ResultList";
import { RaceSkeleton } from "./Skeleton";

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
        {/* The tabs stay in the header while the race loads, so it doesn't jump; none is marked until the office is known. */}
        <ModeNav />
        {error ? <p className="error">{error}</p> : <RaceSkeleton />}
      </div>
    );
  }

  const label = raceLabel(race);
  const mapped = race.counties.some((c) => c.fips);
  const called = race.candidates.find((c) => c.winner);
  const closes = stateFinal(race.state);
  const close = race.pollsClose ? new Date(race.pollsClose) : null;

  return (
    <div className="wrap mt">
      <ModeNav current={race.local ? "/midterms" : SCREEN[race.office]} />
      <nav className="mt-crumbs small" aria-label="Breadcrumb">
        {/* A race found by search has no office screen; it sits under the overview's other races. */}
        <Link href="/midterms">Midterms 2026</Link> › {race.local ? STATE_NAMES[race.state] ?? race.state : <Link href={`${SCREEN[race.office]}?state=${race.state}`}>{STATE_NAMES[race.state] ?? race.state}</Link>} › {race.local ? race.local.type || "Other races" : OFFICE_LABEL[race.office]}
      </nav>
      <header className="mt-race-head">
        <div className="mt-race-title">
          <h1>{label}</h1>
          <RatingTag rating={race.rating} signal={race.signal} />
          <RcvFlag race={race} />
          {favorites.ids !== null && !race.local && <StarButton starred={favorites.ids.includes(race.id)} label={label} onToggle={() => favorites.toggle(race.id)} />}
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
        {race.office === "measure" && !race.local && <p className="muted small">{race.title}</p>}
        {signalLine(race.signal, race) && (
          <p className="mt-meta small">
            <span>
              {signalLine(race.signal, race)}
              {race.signal?.market && ` (${race.signal.market.sources.join(" and ")})`}
              {race.signal?.polls && `, polls through ${race.signal.polls.latest}`}
            </span>
          </p>
        )}
        <RaceStatus race={race} now={now} />
        {data.callPending && <p className="muted small">The call status is catching up with the latest count; it will settle on the next update.</p>}
        <p className="mt-meta small">
          <span title={reportingText(race).title}>{reportingText(race).long}</span>
          {close && close.getTime() !== stateFinal(race.state) && <span title="civicAPI's closing time for this race, which differs from the state's last scheduled closing">civicAPI lists polls closing {stampET(close.getTime())} ET</span>}
          <span>
            Checked <CheckedAgo at={data.fetchedAt} />
            {data.stale && " (results source is slow; showing the last good count)"}
          </span>
        </p>
        {error && <p className="error small">{error} Showing the last results we got.</p>}
        {favorites.error && <p className="error small">{favorites.error}</p>}
      </header>

      <div className="mt-race-grid mt-in">
        <section aria-labelledby="cands">
          <div className="mt-section-head">
            <h2 id="cands">Candidates</h2>
          </div>
          <div className="mt-cands">
            <CandidateTable
              race={race}
              share
              status={called ? `${called.name} declared the winner` : race.total > 0 ? "Total votes" : closes && closes > now ? `Polls close ${stampET(closes)} ET` : "No results yet"}
            />
          </div>
          {race.total > 0 && <TurnoutLine race={race} />}
          <p className="muted small mt-source">
            {called ? `${called.name} was declared the winner by civicAPI's decision desk, not AP or Decision Desk HQ. ` : ""}* Incumbent. <Link href="/midterms/credits">Sources and credits</Link>
          </p>
          {race.total > 0 && <CountingContext race={race} fetchedAt={data.fetchedAt} />}
          {race.office !== "measure" && <RaceInsights race={race} />}
          {data.history && <VoteUpdates history={data.history} />}
          {race.office !== "measure" && <MarketPanel raceId={race.id} />}
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
              {race.local
                ? race.counties.length > 1
                  ? "civicAPI reports this race by town, ward or precinct rather than county, so there's no map. Every area is in the table below."
                  : "civicAPI reports this race as one total, so there's no map."
                : race.counties.length > 1
                  ? `${STATE_NAMES[race.state] ?? race.state} reports by town, so there's no county map. Every town is in the table below.`
                  : "This state reports one statewide total, so there's no county map."}
            </p>
          )}
          {mapped && race.office === "house" && <p className="muted small">Shaded counties are all or partly in this district.</p>}
        </section>
      </div>

      {race.counties.length > 1 && <CountyTable race={race} selected={selected} onSelect={setSelected} />}
    </div>
  );
}
