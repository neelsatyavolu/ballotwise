"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { electionModeDefault } from "@/lib/midterms/polls";
import { STATE_NAMES, type Office, type Overview, type RaceSummary } from "@/lib/midterms/view";
import { CallsFeed } from "./CallsFeed";
import { CheckedAgo } from "./CheckedAgo";
import { useClock, useLive, useStars } from "./hooks";
import { ModeNav } from "./ModeNav";
import { byCloseness, districtFill, nationDistrictFills, regularFirst, SeatHeader, stateFills } from "./OfficeView";
import { PollSchedule } from "./PollClose";
import { RaceRows, type Star } from "./RaceRows";
import { ZoomMap, type Fill } from "./ZoomMap";

type Column = Exclude<Office, "measure">;
const COLUMNS: { office: Column; title: string; href: string }[] = [
  { office: "senate", title: "Senate", href: "/midterms/senate" },
  { office: "house", title: "House", href: "/midterms/house" },
  { office: "governor", title: "Governors", href: "/midterms/governor" },
];

/**
 * One office's dashboard, compact enough to sit beside the other two: seat bar, map and closest races.
 * Picking a statewide race on the map opens its page; the House map zooms to a state's districts first.
 */
function OfficeColumn({ office, title, href, data, results, star }: { office: Column; title: string; href: string; data: Overview; results: boolean; star: Star }) {
  const router = useRouter();
  const [focus, setFocus] = useState<string | null>(null);
  const races = useMemo(() => data.races.filter((r) => r.office === office), [data, office]);
  const updatedAt = data.ratings.updatedAt;
  const fills = useMemo(() => stateFills(office, races, updatedAt, results), [office, races, updatedAt, results]);
  const nationDistricts = useMemo(() => (office === "house" ? nationDistrictFills(races, updatedAt, results) : undefined), [office, races, updatedAt, results]);
  const inState = useMemo(() => races.filter((r) => r.state === focus).sort((a, b) => regularFirst(a, b) || byCloseness(a, b)), [races, focus]);
  const districtFills = useMemo(() => {
    if (office !== "house") return undefined;
    const out = new Map<number, Fill>();
    for (const r of inState) if (r.district !== null && !out.has(r.district)) out.set(r.district, districtFill(r, updatedAt, results));
    return out;
  }, [office, inState, updatedAt, results]);
  const list = useMemo(() => (focus ? inState : [...races].sort(byCloseness)), [focus, inState, races]);
  const open = (r: RaceSummary | undefined) => r && router.push(`/midterms/${r.id}`);
  const pickState = (state: string | null) => {
    if (office === "house") return setFocus(state);
    if (state) open(races.filter((r) => r.state === state).sort(regularFirst)[0]);
  };

  return (
    <section className="mt-sbs-col" aria-label={`${title} dashboard`}>
      <div className="mt-section-head tight">
        <h2>
          <Link href={href}>{title}</Link>
        </h2>
        <span className="muted small">{focus ? `${STATE_NAMES[focus] ?? focus} · ${inState.length} races` : `${races.length} races`}</span>
      </div>
      <SeatHeader office={office} data={data} />
      <ZoomMap
        fills={fills}
        focus={focus}
        onFocus={pickState}
        countyFills={null}
        raceId={null}
        districtFills={districtFills}
        nationDistricts={nationDistricts}
        onPickNationDistrict={(key) => open(races.find((r) => `${r.state}-${r.district ?? 0}` === key))}
        district={null}
        onPickDistrict={(d) => open(inState.find((r) => r.district === d))}
        label={`Map of 2026 ${title.toLowerCase()} races${focus ? `, zoomed to ${STATE_NAMES[focus] ?? focus}` : ""}`}
      />
      <RaceRows races={list} star={star} onPick={(r) => open(r)} />
      <p className="muted small">
        {office === "house" ? "Tap a state to see its districts, or a race to open it." : "Tap a state or a race to open it."}
      </p>
    </section>
  );
}

/** Senate, House and Governor dashboards in columns for wide and ultrawide screens, sharing one live feed. */
export function SideBySide() {
  const { data, error } = useLive<Overview>("/api/midterms");
  const favorites = useStars();
  const results = electionModeDefault(useClock(60_000));
  const star: Star = { ids: favorites.ids, toggle: favorites.toggle };

  return (
    <div className="wrap mt mt-sbs-page">
      <ModeNav current="/midterms/side-by-side" />
      <header className="mt-hero">
        <h1>Side by side</h1>
        <span className="mt-kicker">Senate · House · Governors</span>
        {data && (
          <span className="mt-updated small">
            <span className={`mt-dot${data.stale ? " stale" : ""}`} aria-hidden /> Checked <CheckedAgo at={data.fetchedAt} />
            {data.stale && " · source is slow"}
          </span>
        )}
      </header>
      <p className="muted small mt-sbs-note">Made for wide screens: widen the window, or open this on a large or ultrawide monitor, to see all three offices at once.</p>
      {error && <p className="error">{data ? `${error} Showing the last results we got.` : error}</p>}
      {!data && !error && <p className="muted">Loading every race…</p>}
      {data && (
        <div className="mt-sbs">
          {COLUMNS.map((c) => (
            <OfficeColumn key={c.office} {...c} data={data} results={results} star={star} />
          ))}
          <aside className="mt-sbs-side" aria-label="Latest calls and poll closings">
            <CallsFeed races={data.races} events={data.callEvents} counts={data.callEventCounts} office="all" />
            <PollSchedule races={data.races} picked={[]} onPick={() => {}} />
          </aside>
        </div>
      )}
      <p className="muted small mt-source">
        Live results from <a href="https://civicapi.org">civicAPI</a>, collected from state and county election offices. Each column matches its office&apos;s page; open a column&apos;s title for county maps and race details.
      </p>
    </div>
  );
}
