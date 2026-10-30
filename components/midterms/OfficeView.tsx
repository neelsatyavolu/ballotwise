"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { RaceDetail } from "@/lib/midterms/races";
import { flipTo, isWatch, raceFill } from "@/lib/midterms/explore";
import { electionModeDefault } from "@/lib/midterms/polls";
import { colorOf, compareRaces, lead, leading, measureCount, pct, raceLabel, shade, STATE_NAMES, type Office, type Overview, type RaceSummary } from "@/lib/midterms/view";
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
import { ForecastTip, WatchNote } from "./ForecastTip";

const TITLE: Record<Office, string> = { senate: "Senate", house: "House", governor: "Governors", measure: "Ballot measures" };
const HREF = { senate: "/midterms/senate", house: "/midterms/house", governor: "/midterms/governor", measure: "/midterms/measures" } as const;

/** Specials sort after a state's regular race, so the regular one colors the state. */
export const regularFirst = (a: RaceSummary, b: RaceSummary) => Number(/special/i.test(a.title)) - Number(/special/i.test(b.title));

/** Closest counted races first; before any votes, the most competitive by rating. */
export function byCloseness(a: RaceSummary, b: RaceSummary) {
  const la = lead(a.candidates);
  const lb = lead(b.candidates);
  if (la && lb) return la.margin - lb.margin;
  if (la || lb) return la ? -1 : 1;
  return compareRaces(a, b);
}

function raceTip(r: RaceSummary) {
  return (
    <>
      <b>{raceLabel(r)}</b>
      {r.candidates.slice(0, 3).map((c) => (
        <div key={c.name}>
          <span className="swatch" style={{ background: colorOf(c) }} /> {c.name} {r.total ? pct(c.pct) : ""}
          {c.winner && " ✓"}
        </div>
      ))}
      <span className="muted">{r.reporting ? `${Math.round(r.reporting)}% reporting` : "No results yet"}</span>
      <WatchNote race={r} />
    </>
  );
}

/** A race's hover card: the forecast card before votes, the count after. */
const hoverTip = (r: RaceSummary, updatedAt: number | null) => (r.total ? raceTip(r) : <ForecastTip race={r} updatedAt={updatedAt} />);

/** How a district looks on the House map, nationally or zoomed to its state. */
export function districtFill(r: RaceSummary, updatedAt: number | null, results: boolean): Fill {
  return { fill: raceFill(r, results), flip: !!flipTo(r), called: r.candidates.some((c) => c.winner), watch: results && isWatch(r), tip: hoverTip(r, updatedAt) };
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

/** How each state looks on this office's national map. */
export function stateFills(office: Office, races: RaceSummary[], updatedAt: number | null = null, results = false): Map<string, Fill> {
  const byState = new Map<string, RaceSummary[]>();
  for (const r of races) byState.set(r.state, [...(byState.get(r.state) ?? []), r]);
  const out = new Map<string, Fill>();
  for (const [state, list] of byState) {
    const name = STATE_NAMES[state] ?? state;
    if (office === "senate" || office === "governor") {
      const r = [...list].sort(regularFirst)[0];
      out.set(state, { fill: raceFill(r, results), tip: hoverTip(r, updatedAt), flip: !!flipTo(r), called: r.candidates.some((c) => c.winner), watch: results && isWatch(r) });
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

export function SeatHeader({ office, data }: { office: Office; data: Overview }) {
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
  return <SeatBar office={office} tally={tally} ahead={leading(data.races, office)} />;
}

export function OfficeView({ office, initialState }: { office: Office; initialState: string | null }) {
  const { data, error } = useLive<Overview>("/api/midterms");
  const favorites = useStars();
  const [focus, setFocus] = useState<string | null>(initialState);
  const [picked, setPicked] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  const races = useMemo(() => (data?.races ?? []).filter((r) => r.office === office), [data, office]);
  const updatedAt = data?.ratings.updatedAt ?? null;
  // From election day on, maps drop the forecast and fill in only as results arrive.
  const results = electionModeDefault(useClock(60_000));
  const fills = useMemo(() => stateFills(office, races, updatedAt, results), [office, races, updatedAt, results]);
  const nationDistricts = useMemo(() => (office === "house" ? nationDistrictFills(races, updatedAt, results) : undefined), [office, races, updatedAt, results]);
  // House districts go closest to a toss-up first; other offices keep the regular race first, then ballot order.
  const inState = useMemo(
    () => races.filter((r) => r.state === focus).sort((a, b) => regularFirst(a, b) || (office === "house" ? byCloseness(a, b) : 0) || (a.district ?? 0) - (b.district ?? 0) || a.title.localeCompare(b.title, undefined, { numeric: true })),
    [races, focus, office],
  );
  const statewide = office === "senate" || office === "governor";
  const shownId = focus ? (picked && inState.some((r) => r.id === picked) ? picked : statewide ? (inState[0]?.id ?? null) : null) : null;
  const shown = inState.find((r) => r.id === shownId) ?? null;
  const detail = useLive<{ race: RaceDetail }>(shownId ? `/api/midterms/race/${shownId}` : null);
  const districtFills = useMemo(() => {
    if (office !== "house") return undefined;
    const out = new Map<number, Fill>();
    // inState lists a district's regular race before any special, so the regular one colors it.
    for (const r of inState) if (r.district !== null && !out.has(r.district)) out.set(r.district, districtFill(r, updatedAt, results));
    return out;
  }, [office, inState, updatedAt, results]);
  const countyFills = useMemo(() => {
    if (!detail.data) return null;
    const out = new Map<string, Fill>();
    for (const c of detail.data.race.counties) if (c.fips) out.set(c.fips, { fill: fillFor(c, "results"), tip: <CountyTip county={c} /> });
    return out;
  }, [detail.data]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return races.filter((r) => !q || `${raceLabel(r)} ${r.title} ${STATE_NAMES[r.state] ?? ""} ${r.candidates.map((c) => c.name).join(" ")}`.toLowerCase().includes(q)).sort(byCloseness);
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
          <SeatHeader office={office} data={data} />
          <div className="mt-office mt-in">
            <ZoomMap fills={fills} focus={focus} onFocus={(s) => zoomTo(s)} countyFills={focus && shownId ? (detail.data ? countyFills : undefined) : null} raceId={shownId} districtFills={districtFills} nationDistricts={nationDistricts} onPickNationDistrict={(key) => {
                const r = races.find((x) => `${x.state}-${x.district ?? 0}` === key);
                if (r) zoomTo(r.state, r.id);
              }} district={shown?.district ?? null} onPickDistrict={(d) => setPicked(shown?.district === d ? null : (inState.find((r) => r.district === d)?.id ?? null))} label={`Map of 2026 ${TITLE[office].toLowerCase()} races${focus ? `, zoomed to ${STATE_NAMES[focus]}` : ""}`} />

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
                      {shown.office !== "measure" && <RaceInsights key={`fc${shown.id}`} race={shown} />}
                      {shown.office !== "measure" && <MarketPanel key={shown.id} raceId={shown.id} />}
                    </>
                  )}
                  {inState.length > 1 && (
                    <RaceRows races={inState} star={star} onPick={(r) => setPicked(r.id)} selectedId={shownId} />
                  )}
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
