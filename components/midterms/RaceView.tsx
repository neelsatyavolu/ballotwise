"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ApiError } from "@/lib/client";
import { applyDesk, isDesk, overlayLive } from "@/lib/ddhq/apply";
import type { DdhqRace } from "@/lib/ddhq/votes";
import { useAccount } from "@/components/AccountProvider";
import { stampTime, stateFinal, zoneAbbr } from "@/lib/midterms/polls";
import type { Observation } from "@/lib/midterms/history";
import type { RaceDetail } from "@/lib/midterms/races";
import { OFFICE_LABEL, raceLabel, signalLine, STATE_NAMES } from "@/lib/midterms/view";
import { CandidateTable } from "./CandidateTable";
import { CountyTip, fillFor, type Mode } from "./county";
import { CountyTable } from "./CountyTable";
import { pollInterval, useLive, useStars } from "./hooks";
import { useDeskData } from "./desk";
import { CountyMap, type CountyFill } from "./maps";
import { MarketPanel } from "./MarketPanel";
import { RaceInsights } from "./RaceInsights";
import { ModeNav } from "./ModeNav";
import { RatingTag, StarButton } from "./RaceCard";
import { CountingContext, RaceStatus, TurnoutLine, VoteUpdates } from "./RaceContext";
import { VotesLeftPanel } from "./VotesLeft";
import { CheckedAgo } from "./CheckedAgo";
import { reportingText } from "./reporting";
import { RcvFlag } from "./ResultList";
import { RaceSkeleton } from "./Skeleton";

type Fetched = { race: RaceDetail; fetchedAt: number; stale: boolean; history?: Observation[]; callPending?: boolean };
const SCREEN = { senate: "/midterms/senate", house: "/midterms/house", governor: "/midterms/governor", measure: "/midterms/measures" } as const;

export function RaceView({ id }: { id: number }) {
  const path = `/api/midterms/race/${id}`;
  const { data: rendered, catalogData, error, now } = useLive<Fetched>(path, { forecastOnly: true });
  const { refresh } = useAccount();
  const privateDesk = useDeskData();
  const favorites = useStars();
  const [reply, setReply] = useState<{ seat: string; race: DdhqRace | null; error: string | null; at: number } | null>(null);
  const [mode, setMode] = useState<Mode>("results");
  const [selected, setSelected] = useState<string | null>(null);
  const loaded = catalogData?.race;
  const state = loaded?.state;
  const office = loaded?.office;
  const district = loaded?.district;
  const special = Boolean(loaded && /special/i.test(loaded.title));
  const seat = state && office ? `${office}:${state}:${district ?? ""}:${special ? "s" : "g"}:${privateDesk.owner ?? ""}` : "";
  const privateRace = privateDesk.enabled && !!office && office !== "measure" && !loaded?.local;
  const mine = privateRace && reply?.seat === seat ? reply : null;
  const active = mine?.race ?? null;
  const fallback = mine?.error ? overlayLive(path, catalogData, privateDesk.races, privateDesk.forecast) : null;
  const base = fallback ?? rendered ?? (active ? catalogData : null);
  const data = base && active ? { ...base, race: applyDesk(base.race, active), fetchedAt: mine!.at, stale: false, history: undefined, callPending: false } : base;
  const race = data?.race;

  useEffect(() => {
    if (!privateRace || !state || !office) return;
    const params = new URLSearchParams({ state, office });
    if (district != null) params.set("district", String(district));
    if (special) params.set("special", "1");
    const mine = seat;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    async function load() {
      controller = new AbortController();
      try {
        const response = await fetch(`/api/ddhq/race?${params}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) });
        const next = await response.json() as DdhqRace & { error?: string };
        if (!response.ok) throw new ApiError(next.error ?? "Decision Desk HQ didn't answer.", response.status);
        if (!Array.isArray(next.candidates)) throw new ApiError("Decision Desk HQ has no count available for this race.", 502);
        if (live) setReply({ seat: mine, race: next as DdhqRace, error: null, at: Date.now() });
      } catch (err) {
        if (!live) return;
        setReply({ seat: mine, race: null, error: err instanceof ApiError ? err.message : "Decision Desk HQ didn't answer.", at: Date.now() });
        if (err instanceof ApiError && err.status === 401) void refresh();
      } finally {
        if (live) timer = setTimeout(() => void load(), Math.min(20_000, pollInterval(Date.now())));
      }
    }
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [privateRace, state, office, district, special, seat, refresh]);

  const fills = useMemo(() => {
    const out = new Map<string, CountyFill>();
    for (const c of race?.counties ?? []) if (c.fips) out.set(c.fips, { fill: fillFor(c, mode), tip: <CountyTip county={c} mode={mode} />, active: true });
    return out;
  }, [race, mode]);

  if (!data || !race || privateRace && !active && !mine?.error) {
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
          {close && close.getTime() !== stateFinal(race.state) && <span title="civicAPI's closing time for this race, which differs from the state's last scheduled closing">civicAPI lists polls closing {stampTime(close.getTime())} {zoneAbbr(close.getTime())}</span>}
          <span>
            Checked <CheckedAgo at={data.fetchedAt} />
            {data.stale && " (results source is slow; showing the last good count)"}
          </span>
        </p>
        {error && <p className="error small">{error} Showing the last results we got.</p>}
        {mine?.error && <p className="error small">{mine.error} Showing the public fallback while DDHQ retries.</p>}
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
              status={called ? `${called.name} declared the winner` : race.total > 0 ? "Total votes" : closes && closes > now ? `Polls close ${stampTime(closes)} ${zoneAbbr(closes)}` : "No results yet"}
            />
          </div>
          {race.total > 0 && <TurnoutLine race={race} />}
          <VotesLeftPanel race={race} />
          <p className="muted small mt-source">
            {race.source && (
              <>
                Results from <a href={race.source.url}>{race.source.name}</a>. The county doesn&apos;t mark winners in its results, so this page shows who leads and calls no one.{" "}
              </>
            )}
            {isDesk(race) && called
              ? `Decision Desk HQ called this race for ${called.name}. `
              : called && !race.source
                ? `${called.name} was declared the winner by civicAPI's decision desk, not AP or Decision Desk HQ. `
                : ""}
            * Incumbent. <Link href="/midterms/credits">Sources and credits</Link>
          </p>
          {race.total > 0 && <CountingContext race={race} fetchedAt={data.fetchedAt} />}
          {race.office !== "measure" && <RaceInsights race={race} ddhq={active} />}
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
                  ? `${race.source?.name ?? "civicAPI"} reports this race by town, ward or precinct rather than county, so there's no map. Every area is in the table below.`
                  : `${race.source?.name ?? "civicAPI"} reports this race as one total, so there's no map.`
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
