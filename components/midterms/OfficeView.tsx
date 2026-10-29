"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { RaceDetail } from "@/lib/midterms/races";
import { raceFill, safeSide } from "@/lib/midterms/explore";
import { colorOf, compareRaces, lead, leading, measureCount, pct, projected, raceLabel, RATING_LABEL, shade, STATE_NAMES, timeAgo, type Office, type Overview, type RaceSummary } from "@/lib/midterms/view";
import { SeatBar } from "./Balance";
import { CountyTip, fillFor } from "./county";
import { useLive, useStars } from "./hooks";
import { ModeNav } from "./ModeNav";
import { RaceCard } from "./RaceCard";
import { RaceRows } from "./RaceRows";
import { ZoomMap, type Fill } from "./ZoomMap";

const TITLE: Record<Office, string> = { senate: "Senate", house: "House", governor: "Governors", measure: "Ballot measures" };
const HREF = { senate: "/midterms/senate", house: "/midterms/house", governor: "/midterms/governor", measure: "/midterms/measures" } as const;

/** Specials sort after a state's regular race, so the regular one colors the state. */
const regularFirst = (a: RaceSummary, b: RaceSummary) => Number(/special/i.test(a.title)) - Number(/special/i.test(b.title));

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
    </>
  );
}

/** How a district looks on a zoomed state map, with its projection in the hover card. */
function districtFill(r: RaceSummary): Fill {
  const safe = safeSide(r);
  const projection = r.rating ? RATING_LABEL[r.rating] : safe ? `Safe ${safe}` : "No projection";
  return {
    fill: raceFill(r),
    tip: (
      <>
        {raceTip(r)}
        <div className="muted">Projection: {projection}</div>
      </>
    ),
  };
}

/** How each state looks on this office's national map. */
export function stateFills(office: Office, races: RaceSummary[]): Map<string, Fill> {
  const byState = new Map<string, RaceSummary[]>();
  for (const r of races) byState.set(r.state, [...(byState.get(r.state) ?? []), r]);
  const out = new Map<string, Fill>();
  for (const [state, list] of byState) {
    const name = STATE_NAMES[state] ?? state;
    if (office === "senate" || office === "governor") {
      const r = [...list].sort(regularFirst)[0];
      out.set(state, { fill: raceFill(r), tip: raceTip(r) });
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
  return <SeatBar office={office} tally={tally} ahead={leading(data.races, office)} projected={projected(data.races, office)} />;
}

export function OfficeView({ office, initialState }: { office: Office; initialState: string | null }) {
  const { data, error, now } = useLive<Overview>("/api/midterms");
  const favorites = useStars();
  const [focus, setFocus] = useState<string | null>(initialState);
  const [picked, setPicked] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  const races = useMemo(() => (data?.races ?? []).filter((r) => r.office === office), [data, office]);
  const fills = useMemo(() => stateFills(office, races), [office, races]);
  const inState = useMemo(() => races.filter((r) => r.state === focus).sort((a, b) => regularFirst(a, b) || (a.district ?? 0) - (b.district ?? 0) || a.title.localeCompare(b.title, undefined, { numeric: true })), [races, focus]);
  const statewide = office === "senate" || office === "governor";
  const shownId = focus ? (picked && inState.some((r) => r.id === picked) ? picked : statewide ? (inState[0]?.id ?? null) : null) : null;
  const shown = inState.find((r) => r.id === shownId) ?? null;
  const detail = useLive<{ race: RaceDetail }>(shownId ? `/api/midterms/race/${shownId}` : null);
  const districtFills = useMemo(() => {
    if (office !== "house") return undefined;
    const out = new Map<number, Fill>();
    // inState lists a district's regular race before any special, so the regular one colors it.
    for (const r of inState) if (r.district !== null && !out.has(r.district)) out.set(r.district, districtFill(r));
    return out;
  }, [office, inState]);
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
    <div className="wrap mt">
      <ModeNav current={HREF[office]} />
      <header className="mt-hero">
        <h1>{TITLE[office]}</h1>
        <span className="mt-kicker">{races.length ? `${races.length} races` : ""}</span>
        {data && (
          <span className="mt-updated small">
            <span className={`mt-dot${data.stale ? " stale" : ""}`} aria-hidden /> Checked {timeAgo(data.fetchedAt, now)}
            {data.stale && " · source is slow"}
          </span>
        )}
      </header>
      {error && <p className="error">{data ? `${error} Showing the last results we got.` : error}</p>}
      {!data && !error && <p className="muted">Loading every race…</p>}

      {data && (
        <>
          <SeatHeader office={office} data={data} />
          <div className="mt-office">
            <ZoomMap fills={fills} focus={focus} onFocus={(s) => zoomTo(s)} countyFills={focus && shownId ? (detail.data ? countyFills : undefined) : null} raceId={shownId} districtFills={districtFills} district={shown?.district ?? null} onPickDistrict={(d) => setPicked(shown?.district === d ? null : (inState.find((r) => r.district === d)?.id ?? null))} label={`Map of 2026 ${TITLE[office].toLowerCase()} races${focus ? `, zoomed to ${STATE_NAMES[focus]}` : ""}`} />

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
                  {inState.length > 1 && (
                    <RaceRows races={inState} star={star} onPick={(r) => setPicked(r.id)} selectedId={shownId} />
                  )}
                  {shown ? (
                    <>
                      <ul className="mt-grid one">
                        <RaceCard race={shown} starred={favorites.ids ? favorites.ids.includes(shown.id) : null} onStar={favorites.toggle} />
                      </ul>
                      <p className="small">
                        <Link href={`/midterms/${shown.id}`}>Full results and every county →</Link>
                      </p>
                      {detail.data && !countyFills?.size && <p className="muted small">This state reports by town, so the county map stays blank.</p>}
                    </>
                  ) : (
                    <p className="muted small">{office === "house" ? "Tap a district on the map, or pick one here, to see its counties." : "Pick a measure to see its counties on the map."}</p>
                  )}
                </>
              )}
            </aside>
          </div>
          <p className="muted small mt-source">
            Live results from <a href="https://civicapi.org">civicAPI</a>, collected from state and county election offices. Winners are marked only when civicAPI&apos;s decision desk calls a race; &ldquo;leading&rdquo; counts uncalled races by who is ahead. Ratings come from <a href="https://kalshi.com">Kalshi</a> and <a href="https://polymarket.com">Polymarket</a> prices, or the <a href="https://votehub.com/polls">VoteHub</a> polling average where no market trades.{office === "house" && <> District lines from the <a href="https://www.census.gov/programs-surveys/decennial-census/about/rdo/congressional-districts.html">Census Bureau</a>, as drawn for 2026.</>}{office === "measure" && <> Measure summaries come from <a href="https://ballotpedia.org/2026_ballot_measures">Ballotpedia</a>.</>}
          </p>
        </>
      )}
    </div>
  );
}
