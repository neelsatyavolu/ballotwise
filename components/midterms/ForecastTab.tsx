"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { ForecastOverview } from "@/app/api/midterms/forecast/route";
import { useAccount } from "@/components/AccountProvider";
import { flipTo } from "@/lib/midterms/explore";
import { chamberFromRaces, withServer, type ChamberView, type ForecastOffice } from "@/lib/midterms/forecastTab";
import { ratingFill, type Overview, type RaceSummary } from "@/lib/midterms/view";
import { ForecastHero, ForecastOdds, SeatsByRating } from "./ForecastHero";
import { forecastFill, ForecastRaces } from "./ForecastRaces";
import { ForecastTip } from "./ForecastTip";
import { useLive } from "./hooks";
import { useDeskData } from "./desk";
import type { ChartPoint } from "./LineChart";
import { ModeNav } from "./ModeNav";
import { ForecastSkeleton } from "./Skeleton";
import { ZoomMap, type Fill } from "./ZoomMap";

export type ForecastView = "overview" | ForecastOffice;

const OFFICES: ForecastOffice[] = ["house", "senate", "governor"];
const TITLE: Record<ForecastView, string> = { overview: "Overview", house: "House", senate: "Senate", governor: "Governor" };
const HREF: Record<ForecastView, string> = { overview: "/midterms/forecast", house: "/midterms/forecast/house", senate: "/midterms/forecast/senate", governor: "/midterms/forecast/governor" };
const CHAMBER: Record<ForecastOffice, string> = { house: "House", senate: "Senate", governor: "governorships" };

/** Specials sort after a state's regular race, so the regular one colors the state. */
const regularFirst = (a: RaceSummary, b: RaceSummary) => Number(/special/i.test(a.title)) - Number(/special/i.test(b.title));
const day = (iso: string) => Date.parse(`${iso}T12:00:00Z`) / 1000;
const DAY_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const STAMP = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** One office's chart series from the daily history: Democrats' chance of control and each party's mean seats. */
function series(office: ForecastOffice, forecast: ForecastOverview | null): { control: ChartPoint[]; seats: { D: ChartPoint[]; R: ChartPoint[] } } {
  const rows = forecast?.history?.[office] ?? [];
  return {
    control: rows.map(([d, p]) => [day(d), p] as const),
    seats: { D: rows.map(([d, , dem]) => [day(d), dem] as const), R: rows.map(([d, , , rep]) => [day(d), rep] as const) },
  };
}

/**
 * Where markets join the forecast. Earlier days were recomputed later from polls and fundamentals alone, so the
 * line can step on the first day with market prices; the chart marks that day instead of letting it read as a swing.
 */
function marketsJoined(forecast: ForecastOverview | null, office: ForecastOffice): { t: number; label: string } | null {
  const to = forecast?.history?.backfilled?.to;
  if (!to) return null;
  const next = (forecast?.history?.[office] ?? []).find(([d]) => d > to)?.[0] ?? to;
  return { t: day(next), label: `Markets added ${DAY_LABEL.format(day(next) * 1000)}` };
}

/** The forecast map: districts for the House, states otherwise, colored by rating, with flips striped when asked. */
function ForecastMap({ office, races, updatedAt, flips }: { office: ForecastOffice; races: readonly RaceSummary[]; updatedAt: number | null; flips: boolean }) {
  const router = useRouter();
  const mine = useMemo(() => races.filter((r) => r.office === office).sort(regularFirst), [races, office]);
  const fill = (r: RaceSummary): Fill => ({ fill: forecastFill(r), tip: <ForecastTip race={r} updatedAt={updatedAt} />, flip: flips && !!flipTo(r) });
  const { states, districts, ids } = useMemo(() => {
    const states = new Map<string, Fill>();
    const districts = new Map<string, Fill>();
    const ids = new Map<string, number>();
    for (const r of mine) {
      if (office === "house") {
        const key = `${r.state}-${r.district ?? 0}`;
        if (districts.has(key)) continue;
        districts.set(key, fill(r));
        ids.set(key, r.id);
        // States only carry labels under the districts.
        if (!states.has(r.state)) states.set(r.state, { fill: ratingFill(null), tip: null });
      } else if (!states.has(r.state)) {
        states.set(r.state, fill(r));
        ids.set(r.state, r.id);
      }
    }
    return { states, districts, ids };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `fill` only depends on these
  }, [mine, office, updatedAt, flips]);
  const open = (key: string) => {
    const id = ids.get(key);
    if (id) router.push(`/midterms/${id}`);
  };
  return (
    <ZoomMap
      fills={states}
      focus={null}
      onFocus={(state) => state && office !== "house" && open(state)}
      countyFills={null}
      raceId={null}
      nationDistricts={office === "house" ? districts : undefined}
      onPickNationDistrict={open}
      label={`Forecast map of 2026 ${CHAMBER[office]} races`}
    />
  );
}

/** One office's full forecast: the hero, seats by rating, then the map beside every race. */
function OfficeForecast({ office, data, view, forecast }: { office: ForecastOffice; data: Overview; view: ChamberView; forecast: ForecastOverview | null }) {
  const [flips, setFlips] = useState(false);
  const { control, seats } = series(office, forecast);
  const unit = office === "house" ? "district" : "state";
  const hasProjection = forecast?.source !== "ddhq" || !!forecast.chambers?.[office];
  return (
    <>
      {hasProjection && <ForecastHero office={office} view={view} control={control} seats={seats} marker={marketsJoined(forecast, office)} />}
      <SeatsByRating view={view} office={office} showProjection={hasProjection} />
      <div className="mt-office">
        <div className="mt-fc-mapcol">
          <div className="mt-section-head tight">
            <h2>Forecast map</h2>
            <label className="mt-fc-switch">
              <input type="checkbox" checked={flips} onChange={(e) => setFlips(e.target.checked)} />
              <span aria-hidden />
              Show forecasted flips
            </label>
          </div>
          <ForecastMap office={office} races={data.races} updatedAt={data.ratings.updatedAt} flips={flips} />
          <p className="muted small">
            Each {unit} is shaded by the party favored to win and how safe the race is. Hover a {unit} for its forecast, and select it to open
            the full race.
          </p>
        </div>
        <aside className="mt-panel" aria-label={`Every ${CHAMBER[office]} race`}>
          <div className="mt-section-head tight">
            <h2>Every {office === "governor" ? "governor's" : CHAMBER[office]} race</h2>
          </div>
          <ForecastRaces office={office} races={data.races} limit={25} />
        </aside>
      </div>
    </>
  );
}

/** Where control sits, at the right of each overview card's head. */
const CONTROL_LINE: Record<ForecastOffice, string> = { house: "218 for control", senate: "51 D · 50 R for control", governor: "No majority to win" };

/** The overview: one chamber's hero (House or Senate), then a card per office with its odds and closest races. */
function OverviewPage({ data, views, forecast }: { data: Overview; views: Record<ForecastOffice, ChamberView>; forecast: ForecastOverview | null }) {
  const [chamber, setChamber] = useState<"house" | "senate">("house");
  const { control, seats } = series(chamber, forecast);
  return (
    <>
      <ForecastHero
        office={chamber}
        view={views[chamber]}
        control={control}
        seats={seats}
        marker={marketsJoined(forecast, chamber)}
        controls={
          <div className="mt-seg" role="group" aria-label="Chamber">
            {(["house", "senate"] as const).map((c) => (
              <button key={c} type="button" aria-pressed={chamber === c} onClick={() => setChamber(c)}>
                {CHAMBER[c]}
              </button>
            ))}
          </div>
        }
        action={
          <Link className="mt-fc-full" href={HREF[chamber]}>
            Full {CHAMBER[chamber]} forecast →
          </Link>
        }
      />
      <div className="mt-fc-grid">
        {OFFICES.map((o) => (
          <section key={o} className="mt-fc-card">
            <div className="mt-fc-card-head">
              <h2>
                <Link href={HREF[o]}>{o === "governor" ? "Governors" : CHAMBER[o]}</Link>
              </h2>
              <span className="muted small">{CONTROL_LINE[o]}</span>
            </div>
            <div className="mt-fc-card-body">
              {(forecast?.source !== "ddhq" || forecast.chambers?.[o]) && <ForecastOdds office={o} view={views[o]} control={series(o, forecast).control} />}
              <p className="mt-fc-label">Closest races</p>
              <ForecastRaces office={o} races={data.races} limit={10} />
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

/** The Forecast tab: an overview and one page each for the House, Senate and governors. */
export function ForecastTab({ view }: { view: ForecastView }) {
  const { ddhq } = useAccount();
  const desk = useDeskData();
  const { data, error } = useLive<Overview>("/api/midterms");
  const live = useLive<ForecastOverview>("/api/midterms/forecast");
  const forecast = live.data ?? null;
  // The server's simulation once it has run; until then, seats by rating and expected seats from each race's forecast.
  const views = useMemo(() => {
    if (!data) return null;
    return Object.fromEntries(OFFICES.map((o) => {
      const current = withServer(chamberFromRaces(data.races, o, data.balance[o]), forecast?.chambers?.[o], o);
      if (forecast?.source === "ddhq" && !forecast.chambers?.[o] && forecast.ratings?.[o]) {
        return [o, { ...current, ratings: forecast.ratings[o], notUp: { D: 0, R: 0, other: 0 }, total: data.races.filter((r) => r.office === o).length }];
      }
      return [o, current];
    })) as Record<ForecastOffice, ChamberView>;
  }, [data, forecast]);
  const updatedAt = forecast?.updatedAt ?? data?.ratings.updatedAt ?? null;
  const count = view === "overview" ? 0 : (data?.races.filter((r) => r.office === view).length ?? 0);
  const fallback = desk.forecastStatus === "error" ? "DDHQ unavailable · Ballotwise fallback" : "Loading DDHQ forecast · Ballotwise fallback";
  const kicker = forecast?.source === "ddhq" ? `Decision Desk HQ${count ? ` · ${count} races` : " · Your Votes Pro forecast"}` : ddhq === "connected" ? fallback : view === "overview" ? "Ballotwise model for the House, Senate and governors" : count ? `${count} races` : "";

  return (
    <div className="wrap mt mt-fc">
      <ModeNav current="/midterms/forecast" />
      <header className="mt-hero">
        <h1>{view === "overview" ? "Forecast" : `${TITLE[view]} forecast`}</h1>
        <span className="mt-kicker">{kicker}</span>
        <span className="mt-updated small">
          {updatedAt && `Updated ${STAMP.format(updatedAt)} · `}
          <Link href={forecast?.source === "ddhq" ? "https://votes-docs.decisiondeskhq.com/forecast-methodology" : "/midterms/methodology"}>How it works</Link>
        </span>
      </header>
      {ddhq === "connected" && desk.forecastStatus === "error" && <p className="error" role="status">{desk.forecastError} Retrying automatically.</p>}
      <nav className="mt-seg mt-fc-pages" aria-label="Forecast pages">
        {(Object.keys(TITLE) as ForecastView[]).map((v) => (
          <Link key={v} href={HREF[v]} aria-current={v === view ? "page" : undefined}>
            {TITLE[v]}
          </Link>
        ))}
      </nav>
      {error && !data && <p className="error">{error}</p>}
      {!data && !error && <ForecastSkeleton />}
      {data && views && (view === "overview" ? <OverviewPage data={data} views={views} forecast={forecast} /> : <OfficeForecast office={view} data={data} view={views[view]} forecast={forecast} />)}
    </div>
  );
}
