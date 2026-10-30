"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { ForecastOverview } from "@/app/api/midterms/forecast/route";
import { flipTo } from "@/lib/midterms/explore";
import { chamberFromRaces, withServer, type ChamberView, type ForecastOffice } from "@/lib/midterms/forecastTab";
import { ratingFill, type Overview, type RaceSummary } from "@/lib/midterms/view";
import { ForecastHero, ControlCard, SeatsByRating } from "./ForecastHero";
import { forecastFill, ForecastRaces } from "./ForecastRaces";
import { ForecastTip } from "./ForecastTip";
import { useLive } from "./hooks";
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

/** One office's full forecast: the hero, seats by rating, the map and every race. */
function OfficeForecast({ office, data, view, forecast }: { office: ForecastOffice; data: Overview; view: ChamberView; forecast: ForecastOverview | null }) {
  const [flips, setFlips] = useState(false);
  const { control, seats } = series(office, forecast);
  const unit = office === "house" ? "district" : "state";
  return (
    <>
      <ForecastHero office={office} view={view} updatedAt={forecast?.updatedAt ?? data.ratings.updatedAt} control={control} seats={seats} marker={marketsJoined(forecast, office)} />
      <section className="mt-fc-section">
        <h2>Mapping the forecast</h2>
        <p className="muted">
          Each {unit} is shaded by the party favored to win and how safe the race is. Hover a {unit} for its forecast, and select it to
          open the full race.
        </p>
        <SeatsByRating view={view} office={office} />
        <label className="mt-fc-switch">
          <input type="checkbox" checked={flips} onChange={(e) => setFlips(e.target.checked)} />
          <span aria-hidden />
          Show forecasted flips
        </label>
        <ForecastMap office={office} races={data.races} updatedAt={data.ratings.updatedAt} flips={flips} />
      </section>
      <section className="mt-fc-section">
        <h2>Every {office === "governor" ? "governor's" : CHAMBER[office]} race</h2>
        <ForecastRaces office={office} races={data.races} limit={25} />
      </section>
    </>
  );
}

/** The sentence over each overview card: the chance of control and projected seats. */
function summary(office: ForecastOffice, view: ChamberView): string {
  if (office === "governor") return `Ballotwise's model projects Democrats to hold ${view.dSeats} governorships and Republicans ${view.rSeats}. The table lists the most competitive races, closest to a toss-up first.`;
  const lead = view.dControl === null ? `projects Democrats to win ${view.dSeats} seats` : `gives Democrats a ${Math.round(view.dControl * 100)}% chance of winning the ${CHAMBER[office]}, with a projected ${view.dSeats} seats`;
  return `Ballotwise's model ${lead}. The table lists the most competitive races, closest to a toss-up first.`;
}

/** The overview: one chamber's hero (House or Senate), then a card of competitive races and a control card for each office. */
function OverviewPage({ data, views, forecast }: { data: Overview; views: Record<ForecastOffice, ChamberView>; forecast: ForecastOverview | null }) {
  const [chamber, setChamber] = useState<"house" | "senate">("house");
  const { control, seats } = series(chamber, forecast);
  return (
    <>
      <div className="mt-fc-chambers">
        <span>Chambers</span>
        <div className="mt-seg" role="group" aria-label="Chamber">
          {(["house", "senate"] as const).map((c) => (
            <button key={c} type="button" aria-pressed={chamber === c} onClick={() => setChamber(c)}>
              {CHAMBER[c]}
            </button>
          ))}
        </div>
      </div>
      <ForecastHero
        office={chamber}
        view={views[chamber]}
        updatedAt={forecast?.updatedAt ?? data.ratings.updatedAt}
        control={control}
        seats={seats}
        marker={marketsJoined(forecast, chamber)}
        action={
          <Link className="btn secondary small mt-fc-full" href={HREF[chamber]}>
            View full {CHAMBER[chamber]} forecast →
          </Link>
        }
      />
      <div className="mt-fc-grid">
        {OFFICES.map((o) => (
          <section key={o} className="mt-fc-card">
            <h2>
              <Link href={HREF[o]}>2026 {o === "governor" ? "Governor" : CHAMBER[o]} Forecast ›</Link>
            </h2>
            <p className="muted small">{summary(o, views[o])}</p>
            <ForecastRaces office={o} races={data.races} limit={10} />
          </section>
        ))}
      </div>
      <div className="mt-fc-grid">
        <ControlCard title="House control" view={views.house} href={HREF.house} office="house" control={series("house", forecast).control} />
        <ControlCard title="Senate control" view={views.senate} href={HREF.senate} office="senate" control={series("senate", forecast).control} />
        <ControlCard title="Governorships" view={views.governor} href={HREF.governor} office="governor" control={[]} />
      </div>
    </>
  );
}

/** The Forecast tab, after DDHQ's forecast pages: an overview and one page each for the House, Senate and governors. */
export function ForecastTab({ view }: { view: ForecastView }) {
  const { data, error } = useLive<Overview>("/api/midterms");
  const live = useLive<ForecastOverview>("/api/midterms/forecast");
  const forecast = live.data ?? null;
  // The server's simulation once it has run; until then, seats by rating and expected seats from each race's forecast.
  const views = useMemo(() => {
    if (!data) return null;
    return Object.fromEntries(OFFICES.map((o) => [o, withServer(chamberFromRaces(data.races, o, data.balance[o]), forecast?.chambers?.[o], o)])) as Record<ForecastOffice, ChamberView>;
  }, [data, forecast]);

  return (
    <div className="wrap mt mt-fc">
      <ModeNav current="/midterms/forecast" />
      <header className="mt-fc-top">
        <p className="mt-fc-crumb">
          <Link href={HREF.overview}>Forecast</Link>
          <span aria-hidden>›</span>
          <b>{TITLE[view]}</b>
        </p>
        <nav className="mt-fc-nav" aria-label="Forecast pages">
          {(Object.keys(TITLE) as ForecastView[]).map((v) => (
            <Link key={v} href={HREF[v]} aria-current={v === view ? "page" : undefined}>
              {TITLE[v]}
            </Link>
          ))}
        </nav>
      </header>
      {error && !data && <p className="error">{error}</p>}
      {!data && !error && <ForecastSkeleton />}
      {data && views && (view === "overview" ? <OverviewPage data={data} views={views} forecast={forecast} /> : <OfficeForecast office={view} data={data} view={views[view]} forecast={forecast} />)}
    </div>
  );
}
