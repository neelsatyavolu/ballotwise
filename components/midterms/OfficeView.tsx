"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ForecastOverview } from "@/app/api/midterms/forecast/route";
import type { RaceDetail } from "@/lib/midterms/races";
import { projection } from "@/lib/midterms/forecastTab";
import { closestFirst, flipTo, isCompetitive, isTossup, raceFill } from "@/lib/midterms/explore";
import { districtMargin2024, margin2024Label, stateMargin2024 } from "@/lib/midterms/past2024";
import { showsResults } from "@/lib/midterms/polls";
import { lead, leading, measureCount, raceLabel, shade, STATE_NAMES, type Office, type Overview, type RaceSummary } from "@/lib/midterms/view";
import { SeatBar } from "./Balance";
import { CountyTip, fillFor } from "./county";
import { useClock, useLive, useStars } from "./hooks";
import { MarketPanel } from "./MarketPanel";
import { RaceInsights } from "./RaceInsights";
import { ModeNav } from "./ModeNav";
import { RaceCard } from "./RaceCard";
import { RaceRows } from "./RaceRows";
import { OfficeSkeleton } from "./Skeleton";
import { ZoomMap, type Fill } from "./ZoomMap";
import { CheckedAgo, LiveDot } from "./CheckedAgo";
import { ForecastTip } from "./ForecastTip";
import { VotesLeftCard } from "./VotesLeft";
import { RaceTip } from "./RaceTip";

const TITLE: Record<Office, string> = { senate: "Senate", house: "House", governor: "Governors", measure: "Ballot measures" };
const HREF = { senate: "/midterms/senate", house: "/midterms/house", governor: "/midterms/governor", measure: "/midterms/measures" } as const;

/** Specials sort after a state's regular race, so the regular one colors the state. */
export const regularFirst = (a: RaceSummary, b: RaceSummary) => Number(/special/i.test(a.title)) - Number(/special/i.test(b.title));

/** A race's hover card: the forecast card before votes, the count after. */
const hoverTip = (r: RaceSummary, updatedAt: number | null) => (r.total ? <RaceTip race={r} /> : <ForecastTip race={r} updatedAt={updatedAt} />);

/** How a district looks on the House map, nationally or zoomed to its state. */
export function districtFill(r: RaceSummary, updatedAt: number | null, results: boolean): Fill {
  return { fill: raceFill(r, results), flip: !!flipTo(r) && (!results || r.total > 0), called: r.candidates.some((c) => c.winner), watch: results && isTossup(r), lean: results && isCompetitive(r), tip: hoverTip(r, updatedAt) };
}

/** Every House district for the national map, keyed "PA-7" (at-large seats "WY-0"); a district's regular race colors it. */
export function nationDistrictFills(races: RaceSummary[], updatedAt: number | null, results: boolean): Map<string, Fill> {
  const out = new Map<string, Fill>();
  for (const r of [...races].sort(regularFirst)) {
    const key = `${r.state}-${r.district ?? 0}`;
    if (!out.has(key)) out.set(key, districtFill(r, updatedAt, results));
  }
  return out;
}

/** How a place looks in the map's 2024 view: shaded by the 2024 presidential margin, with it in the hover card. */
function fill2024(name: string, margin: number | null): Fill {
  return {
    fill: margin === null ? "var(--rule)" : shade(margin > 0 ? "var(--dem)" : "var(--rep)", Math.abs(margin)),
    tip: (
      <>
        <b>{name}</b>
        <div>2024 president: {margin === null ? "no figure" : margin2024Label(margin)}</div>
      </>
    ),
  };
}

/** The map's 2024 view of the same places `now` colors: states, and House districts keyed "PA-7". */
const states2024 = (now: Map<string, Fill>) => new Map([...now.keys()].map((st) => [st, fill2024(STATE_NAMES[st] ?? st, stateMargin2024(st))]));
const nationDistricts2024 = (now: Map<string, Fill>) =>
  new Map(
    [...now.keys()].map((key) => {
      const [st, d] = key.split("-");
      return [key, fill2024(`${st}-${Number(d) || "AL"}`, districtMargin2024(st, Number(d)))];
    }),
  );

/** The Senate and House maps' switch between this year's races and the 2024 presidential result. */
function Year2024Toggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="mt-seg mt-year-toggle" role="group" aria-label="Map year">
      <button type="button" aria-pressed={!on} onClick={() => onChange(false)}>2026</button>
      <button type="button" aria-pressed={on} onClick={() => onChange(true)} title="The 2024 presidential result: each state and district shaded by Harris's or Trump's margin" aria-label="2024 president">2024</button>
    </div>
  );
}

/** How each state looks on this office's national map. */
/** `fills` with each state's label carrying its race's lead ("+6.4"; the regular race where there are two), once counted. */
export function withLeads(fills: Map<string, Fill>, races: readonly RaceSummary[]): Map<string, Fill> {
  return new Map(
    [...fills].map(([state, fill]) => {
      const ahead = lead([...races].filter((r) => r.state === state).sort(regularFirst)[0]?.candidates ?? []);
      return [state, ahead ? { ...fill, lead: `+${ahead.margin.toFixed(1)}` } : fill];
    }),
  );
}

export function stateFills(office: Office, races: RaceSummary[], updatedAt: number | null = null, results = false): Map<string, Fill> {
  const byState = new Map<string, RaceSummary[]>();
  for (const r of races) byState.set(r.state, [...(byState.get(r.state) ?? []), r]);
  const out = new Map<string, Fill>();
  for (const [state, list] of byState) {
    const name = STATE_NAMES[state] ?? state;
    if (office === "senate" || office === "governor") {
      const r = [...list].sort(regularFirst)[0];
      out.set(state, { fill: raceFill(r, results), tip: hoverTip(r, updatedAt), flip: !!flipTo(r) && (!results || r.total > 0), called: r.candidates.some((c) => c.winner), watch: results && isTossup(r), lean: results && isCompetitive(r) });
    } else if (office === "house") {
      const ahead = leading(list, "house");
      const won = { D: 0, R: 0 };
      for (const r of list) {
        const w = r.candidates.find((c) => c.winner);
        if (w && /^Democrat/i.test(w.party)) won.D += 1;
        else if (w && /^Republican/i.test(w.party)) won.R += 1;
      }
      const d = won.D + ahead.D;
      const rep = won.R + ahead.R;
      const competitive = list.filter((r) => r.rating).length;
      out.set(state, {
        fill: d + rep === 0 ? (competitive ? "var(--tossup-soft)" : "var(--rule-strong)") : d === rep ? "var(--tossup)" : shade(d > rep ? "var(--dem)" : "var(--rep)", (Math.abs(d - rep) / list.length) * 40),
        tip: (
          <>
            <b>{name}</b>
            <div>{list.length} seats{competitive ? ` · ${competitive} competitive` : ""}</div>
            {d + rep > 0 && (
              <div>
                Dem {won.D} won, {ahead.D} leading · Rep {won.R} won, {ahead.R} leading
              </div>
            )}
          </>
        ),
      });
    } else {
      const count = measureCount(list);
      out.set(state, {
        fill: "color-mix(in srgb, var(--accent) 30%, var(--sheet))",
        tip: (
          <>
            <b>{name}</b>
            <div>{list.length} statewide measures</div>
            {count.passed + count.failed > 0 && <div>{count.passed} passed · {count.failed} failed</div>}
          </>
        ),
      });
    }
  }
  return out;
}

/** The office's seat bar: before votes, with the forecast's projected seats (pass `forecast`); after, seats won and led. */
export function SeatHeader({ office, data, forecast = null }: { office: Office; data: Overview; forecast?: ForecastOverview | null }) {
  if (office === "measure") {
    const c = measureCount(data.races);
    return (
      <section className="mt-seats">
        <div className="mt-seats-nums">
          <span className="yes"><b>{c.passed}</b> passed</span>
          <span className="mt-seats-mid">{c.counting} still counting · Yes ahead in {c.yesAhead}, No ahead in {c.noAhead}</span>
          <span className="no">failed <b>{c.failed}</b></span>
        </div>
      </section>
    );
  }
  const tally = office === "senate" ? data.balance.senate : office === "house" ? data.balance.house : data.balance.governor;
  return <SeatBar office={office} tally={tally} ahead={leading(data.races, office)} projected={projection(data.races, office, tally, forecast?.chambers?.[office], forecast?.source ?? data.forecastSource)} />;
}

export function OfficeView({ office, initialState }: { office: Office; initialState: string | null }) {
  const { data, catalogData, error } = useLive<Overview>("/api/midterms", { office });
  const forecast = useLive<ForecastOverview>("/api/midterms/forecast").data;
  const favorites = useStars();
  const [focus, setFocus] = useState<string | null>(initialState);
  const [picked, setPicked] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  // The Senate and House maps can show the 2024 presidential result in place of this year's races.
  const offers2024 = office === "senate" || office === "house";
  const [show2024, setShow2024] = useState(false);
  const past = offers2024 && show2024;

  const races = useMemo(() => (data?.races ?? []).filter((r) => r.office === office), [data, office]);
  const updatedAt = data?.ratings.updatedAt ?? null;
  // From election day on, maps drop the forecast and fill in only as results arrive.
  const results = showsResults(useClock(60_000));
  const fillsNow = useMemo(() => stateFills(office, races, updatedAt, results), [office, races, updatedAt, results]);
  const fills = useMemo(() => (past ? states2024(fillsNow) : fillsNow), [past, fillsNow]);
  const nationDistrictsNow = useMemo(() => (office === "house" ? nationDistrictFills(races, updatedAt, results) : undefined), [office, races, updatedAt, results]);
  const nationDistricts = useMemo(() => (past && nationDistrictsNow ? nationDistricts2024(nationDistrictsNow) : nationDistrictsNow), [past, nationDistrictsNow]);
  // House districts go closest to a toss-up first; other offices keep the regular race first, then ballot order.
  const inState = useMemo(
    () => races.filter((r) => r.state === focus).sort((a, b) => regularFirst(a, b) || (office === "house" ? closestFirst(a, b) : 0) || (a.district ?? 0) - (b.district ?? 0) || a.title.localeCompare(b.title, undefined, { numeric: true })),
    [races, focus, office],
  );
  const statewide = office === "senate" || office === "governor";
  const shownId = focus ? (picked && inState.some((r) => r.id === picked) ? picked : statewide ? (inState[0]?.id ?? null) : null) : null;
  const shown = inState.find((r) => r.id === shownId) ?? null;
  // The race before a Votes Pro (DDHQ) overlay, which clears its polls and market signal: whether those panels are coming.
  const publicSignal = (catalogData?.races.find((r) => r.id === shownId) ?? shown)?.signal;
  // Once the shown race is counting, votes left takes the place of its polls and markets.
  const counting = !!shown && shown.total > 0;
  const detail = useLive<{ race: RaceDetail }>(shownId ? `/api/midterms/race/${shownId}` : null);
  const districtFills = useMemo(() => {
    if (office !== "house") return undefined;
    const out = new Map<number, Fill>();
    // inState lists a district's regular race before any special, so the regular one colors it.
    for (const r of inState) {
      if (r.district === null || out.has(r.district)) continue;
      out.set(r.district, past ? fill2024(raceLabel(r), districtMargin2024(r.state, r.district)) : districtFill(r, updatedAt, results));
    }
    return out;
  }, [office, inState, updatedAt, results, past]);
  const countyFills = useMemo(() => {
    if (!detail.data) return null;
    const mode = past ? "2024" : "results";
    const out = new Map<string, Fill>();
    for (const c of detail.data.race.counties) if (c.fips) out.set(c.fips, { fill: fillFor(c, mode), tip: <CountyTip county={c} mode={mode} /> });
    return out;
  }, [detail.data, past]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return races.filter((r) => !q || `${raceLabel(r)} ${r.title} ${STATE_NAMES[r.state] ?? ""} ${r.candidates.map((c) => c.name).join(" ")}`.toLowerCase().includes(q)).sort(closestFirst);
  }, [races, query]);
  const star = { ids: favorites.ids, toggle: favorites.toggle };

  function zoomTo(state: string | null, raceId: number | null = null) {
    setFocus(state);
    setPicked(raceId);
  }

  return (
    <div className="wrap mt mt-office-page">
      <ModeNav current={HREF[office]} />
      <header className="mt-hero">
        <h1>{TITLE[office]}</h1>
        <span className="mt-kicker">{races.length ? `${races.length} races` : ""}</span>
        {data && (
          <span className="mt-updated small">
            <LiveDot at={data.fetchedAt} stale={data.stale} /> Checked <CheckedAgo at={data.fetchedAt} />
            {data.stale && " · source is slow"}
          </span>
        )}
      </header>
      {error && <p className="error">{data ? `${error} Showing the last results we got.` : error}</p>}
      {!data && !error && <OfficeSkeleton />}

      {data && (
        <>
          <SeatHeader office={office} data={data} forecast={forecast} />
          <div className="mt-office mt-in">
            <ZoomMap fills={fills} focus={focus} onFocus={(s) => zoomTo(s)} countyFills={focus && shownId ? (detail.data ? countyFills : undefined) : null} raceId={shownId} districtFills={districtFills} nationDistricts={nationDistricts} onPickNationDistrict={(key) => {
                const r = races.find((x) => `${x.state}-${x.district ?? 0}` === key);
                if (r) zoomTo(r.state, r.id);
              }} district={shown?.district ?? null} onPickDistrict={(d) => setPicked(shown?.district === d ? null : (inState.find((r) => r.district === d)?.id ?? null))} label={past ? `Map of the 2024 presidential result where 2026 ${TITLE[office].toLowerCase()} races are${focus ? `, zoomed to ${STATE_NAMES[focus]}` : ""}` : `Map of 2026 ${TITLE[office].toLowerCase()} races${focus ? `, zoomed to ${STATE_NAMES[focus]}` : ""}`} corner={offers2024 && <Year2024Toggle on={show2024} onChange={setShow2024} />} />

            <aside className="mt-panel" aria-label={focus ? `${STATE_NAMES[focus]} races` : "All races"}>
              {!focus ? (
                <>
                  <div className="mt-section-head tight">
                    <h2>{office === "measure" ? "Every measure" : "Closest races"}</h2>
                    <input className="input mt-search" type="search" placeholder="Find a race" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a race" />
                  </div>
                  <RaceRows races={list} star={star} onPick={(r) => zoomTo(r.state, r.id)} />
                  <p className="muted small">Tap a state on the map, or a race here, to zoom in.</p>
                </>
              ) : (
                <>
                  <div className="mt-section-head tight">
                    <h2>{STATE_NAMES[focus] ?? focus}</h2>
                    <button type="button" className="btn quiet" onClick={() => zoomTo(null)}>
                      ← All states
                    </button>
                  </div>
                  {shown && (
                    <>
                      <ul className="mt-grid one">
                        <RaceCard race={shown} starred={favorites.ids ? favorites.ids.includes(shown.id) : null} onStar={favorites.toggle} />
                      </ul>
                      <p className="small">
                        <Link href={`/midterms/${shown.id}`}>Full results and every county →</Link>
                      </p>
                      {detail.data && !countyFills?.size && <p className="muted small">This state reports by town, so the county map stays blank.</p>}
                      {counting && detail.data && <VotesLeftCard race={detail.data.race} />}
                      {shown.office !== "measure" && <RaceInsights key={`fc${shown.id}`} race={shown} pollsExpected={!!publicSignal?.polls} polls={!counting} />}
                    </>
                  )}
                  {inState.length > 1 && (
                    <RaceRows races={inState} star={star} onPick={(r) => setPicked(r.id)} selectedId={shownId} />
                  )}
                  {/* The market viewer comes last, below everything else for the state. */}
                  {shown && shown.office !== "measure" && !counting && <MarketPanel key={shown.id} raceId={shown.id} expected={!!publicSignal?.market} />}
                </>
              )}
            </aside>
          </div>
          <p className="muted small mt-source"><Link href="/midterms/credits">Sources and credits</Link></p>
        </>
      )}
    </div>
  );
}
