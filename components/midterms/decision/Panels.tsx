"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { clockNow } from "@/lib/midterms/clock";
import type { ChamberOffice, Panel } from "@/lib/midterms/decisionView";
import { projection } from "@/lib/midterms/forecastTab";
import { stampET, stateFinal, electionModeDefault } from "@/lib/midterms/polls";
import { fmt, lead, leading, raceLabel, STATE_NAMES, type RaceSummary } from "@/lib/midterms/view";
import { SeatBar } from "../Balance";
import { CallsFeed } from "../CallsFeed";
import { CandidateTable } from "../CandidateTable";
import { CountyTip, fillFor } from "../county";
import { PartyOdds } from "../ForecastHero";
import { LineChart, type ChartPoint } from "../LineChart";
import { CountyMap, type CountyFill } from "../maps";
import { MarketPanel } from "../MarketPanel";
import { nationDistrictFills, stateFills } from "../OfficeView";
import { PollSchedule } from "../PollClose";
import { RaceInsights } from "../RaceInsights";
import { ZoomMap } from "../ZoomMap";
import { useDashboardData, type RaceData } from "./data";

const CHAMBER_NAME: Record<ChamberOffice, string> = { house: "2026 U.S. House", senate: "2026 U.S. Senate", governor: "2026 Governor" };
const day = (iso: string) => Date.parse(`${iso}T12:00:00Z`) / 1000;
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
const SMALL = { w: 320, h: 150 };

const Empty = ({ children }: { children: string }) => <p className="mt-dv-empty">{children}</p>;

/** A panel's race: the full detail when fetched, else the overview's summary of a tracked race. */
function useRace(id: number | undefined): { race: RaceSummary | null; data: RaceData | null; missing: boolean } {
  const { races, overview } = useDashboardData();
  const got = id ? races.get(id) : undefined;
  if (got === "missing") return { race: null, data: null, missing: true };
  if (got) return { race: got.race, data: got, missing: false };
  return { race: overview?.races.find((r) => r.id === id) ?? null, data: null, missing: false };
}

/** The bold name in a panel's header: the race, or the chamber. */
export function panelTitle(p: Panel, find: (id: number) => RaceSummary | undefined): string {
  if (p.office) return CHAMBER_NAME[p.office];
  if (p.raceId) {
    const r = find(p.raceId);
    return r ? `2026 ${r.office === "house" ? `${r.state} US House ${r.district || "AL"}` : raceLabel(r)}` : "Race";
  }
  return p.type === "calls" ? "Latest calls" : p.type === "pollClosings" ? "Poll closings" : "";
}

function Status({ race }: { race: RaceSummary }) {
  const ahead = lead(race.candidates);
  if (race.candidates.some((c) => c.winner)) return <span className="called">Called</span>;
  if (ahead) return <span>Lead {ahead.margin.toFixed(1)} pts</span>;
  const final = stateFinal(race.state);
  return <span>{final && final > clockNow() ? `Polls close ${stampET(final)} ET` : "No results yet"}</span>;
}

function Topline({ id, short }: { id?: number; short: boolean }) {
  const { race, missing } = useRace(id);
  if (missing) return <Empty>This race isn&apos;t available.</Empty>;
  if (!race) return <Empty>Loading…</Empty>;
  const table = <CandidateTable race={race} status={<Status race={race} />} short={short} fill />;
  // Narrow panels drop the party column: the color bar already says it, and names get the room.
  return short ? <div className="mt-dv-compact">{table}</div> : table;
}

function RaceMap({ id }: { id?: number }) {
  const { race, data, missing } = useRace(id);
  const [selected, setSelected] = useState<string | null>(null);
  const fills = useMemo(() => {
    const out = new Map<string, CountyFill>();
    for (const c of data?.race.counties ?? []) if (c.fips) out.set(c.fips, { fill: fillFor(c, "results"), tip: <CountyTip county={c} />, active: true });
    return out;
  }, [data]);
  if (missing) return <Empty>This race isn&apos;t available.</Empty>;
  if (!race) return <Empty>Loading…</Empty>;
  if (!STATE_NAMES[race.state]) return <Empty>No map for this race.</Empty>;
  return <CountyMap state={race.state} fills={fills} selected={selected} onSelect={setSelected} />;
}

/** Each time the count moved: when, how many votes it added, and who led by how much after it. */
function VoteDrops({ id }: { id?: number }) {
  const { data, missing } = useRace(id);
  if (missing) return <Empty>This race isn&apos;t available.</Empty>;
  const history = [...(data?.history ?? [])].sort((a, b) => b.at - a.at);
  if (!history.length) return <Empty>No vote drops reported yet.</Empty>;
  return (
    <ol className="mt-dv-drops">
      {history.map((o, i) => {
        const added = o.total - (history[i + 1]?.total ?? 0);
        return (
          <li key={o.at}>
            <span className="muted">{TIME.format(o.at)} ET</span>
            <b>{added > 0 ? `+${fmt(added)}` : fmt(added)} votes</b>
            <span>{o.leadName ? `${o.leadName} +${(o.margin ?? 0).toFixed(1)}` : "—"}</span>
            {o.corrected && <span className="muted">corrected</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** The leader's lead after each vote drop, over the night. */
function VoteHistory({ id }: { id?: number }) {
  const { data, missing } = useRace(id);
  if (missing) return <Empty>This race isn&apos;t available.</Empty>;
  const points: ChartPoint[] = [...(data?.history ?? [])].sort((a, b) => a.at - b.at).map((o) => [o.at / 1000, o.margin ?? 0] as const);
  return (
    <LineChart
      lines={[{ name: "Lead", color: "var(--accent)", points }]}
      domain="auto"
      step={1}
      size={SMALL}
      value={(v) => `${v.toFixed(1)} pts`}
      date={(t) => `${TIME.format(t * 1000)} ET`}
      label="The leader's margin after each vote drop"
      empty="No vote drops reported yet."
    />
  );
}

function useChamber(office?: ChamberOffice) {
  const { forecast } = useDashboardData();
  const rows = office ? (forecast?.history?.[office] ?? []) : [];
  return {
    view: office ? forecast?.chambers?.[office] : undefined,
    control: rows.map(([d, p]) => [day(d), p] as const) as ChartPoint[],
    seats: { D: rows.map(([d, , dem]) => [day(d), dem] as const) as ChartPoint[], R: rows.map(([d, , , rep]) => [day(d), rep] as const) as ChartPoint[] },
  };
}

function ChamberControl({ office }: { office?: ChamberOffice }) {
  const { view, control } = useChamber(office);
  if (!view) return <Empty>The forecast is loading.</Empty>;
  return <PartyOdds dControl={view.dControl} control={control} />;
}

function WinChart({ office }: { office?: ChamberOffice }) {
  const { control } = useChamber(office);
  return (
    <LineChart
      lines={[
        { name: "Democrats", color: "var(--dem-ink)", points: control },
        { name: "Republicans", color: "var(--rep-ink)", points: control.map(([t, p]) => [t, 1 - p] as const) },
      ]}
      ticks={[0, 0.5, 1]}
      size={SMALL}
      value={(v) => `${Math.round(v * 100)}%`}
      date={(t) => DAY.format(t * 1000)}
      label="Chance of control over time"
      empty="Not enough forecast history yet."
    />
  );
}

function SeatsChart({ office }: { office?: ChamberOffice }) {
  const { seats } = useChamber(office);
  return (
    <LineChart
      lines={[
        { name: "Democrats", color: "var(--dem-ink)", points: seats.D },
        { name: "Republicans", color: "var(--rep-ink)", points: seats.R },
      ]}
      domain="auto"
      size={SMALL}
      value={(v) => `${Math.round(v)} seats`}
      date={(t) => DAY.format(t * 1000)}
      label="Projected seats over time"
      empty="Not enough forecast history yet."
    />
  );
}

function BalanceTopline({ office }: { office?: ChamberOffice }) {
  const { overview, forecast } = useDashboardData();
  if (!overview || !office) return <Empty>Loading…</Empty>;
  const tally = overview.balance[office];
  return <SeatBar office={office} tally={tally} ahead={leading(overview.races, office)} projected={projection(overview.races, office, tally, forecast?.chambers?.[office])} />;
}

function BalanceMap({ office }: { office?: ChamberOffice }) {
  const { overview } = useDashboardData();
  const router = useRouter();
  const [focus, setFocus] = useState<string | null>(null);
  const results = electionModeDefault(clockNow());
  const races = useMemo(() => (overview?.races ?? []).filter((r) => r.office === office), [overview, office]);
  const updatedAt = overview?.ratings.updatedAt ?? null;
  const fills = useMemo(() => (office ? stateFills(office, races, updatedAt, results) : new Map()), [office, races, updatedAt, results]);
  const districts = useMemo(() => (office === "house" ? nationDistrictFills(races, updatedAt, results) : undefined), [office, races, updatedAt, results]);
  if (!overview || !office) return <Empty>Loading…</Empty>;
  return (
    <ZoomMap
      fills={fills}
      focus={office === "house" ? focus : null}
      onFocus={(s) => {
        if (office === "house") return setFocus(s);
        const r = races.find((x) => x.state === s);
        if (r) router.push(`/midterms/${r.id}`);
      }}
      countyFills={null}
      raceId={null}
      label={`${CHAMBER_NAME[office]} map`}
      nationDistricts={districts}
      onPickNationDistrict={(key) => {
        const r = races.find((x) => `${x.state}-${x.district ?? 0}` === key);
        if (r) router.push(`/midterms/${r.id}`);
      }}
    />
  );
}

function Calls() {
  const { overview } = useDashboardData();
  if (!overview) return <Empty>Loading…</Empty>;
  return <CallsFeed races={overview.races} events={overview.callEvents} counts={overview.callEventCounts} office="all" />;
}

function PollClosings() {
  const { overview } = useDashboardData();
  if (!overview) return <Empty>Loading…</Empty>;
  return <PollSchedule races={overview.races} picked={[]} onPick={() => {}} />;
}

function Forecast({ id }: { id?: number }) {
  const { race, missing } = useRace(id);
  if (missing) return <Empty>This race isn&apos;t available.</Empty>;
  if (!race) return <Empty>Loading…</Empty>;
  return <RaceInsights race={race} />;
}

/** A panel's body by type. Section headers are drawn by the board itself. */
export function PanelBody({ panel }: { panel: Panel }) {
  switch (panel.type) {
    case "topline":
      // Narrow panels show last names, as DDHQ's cards do.
      return <Topline id={panel.raceId} short={panel.w < 8} />;
    case "map":
      return <RaceMap id={panel.raceId} />;
    case "market":
      return panel.raceId ? <MarketPanel raceId={panel.raceId} /> : null;
    case "forecast":
      return <Forecast id={panel.raceId} />;
    case "voteDrops":
      return <VoteDrops id={panel.raceId} />;
    case "voteHistory":
      return <VoteHistory id={panel.raceId} />;
    case "chamberControl":
      return <ChamberControl office={panel.office} />;
    case "balanceTopline":
      return <BalanceTopline office={panel.office} />;
    case "balanceMap":
      return <BalanceMap office={panel.office} />;
    case "winChart":
      return <WinChart office={panel.office} />;
    case "seatsChart":
      return <SeatsChart office={panel.office} />;
    case "calls":
      return <Calls />;
    case "pollClosings":
      return <PollClosings />;
    default:
      return null;
  }
}

/** Where a panel's header links: the race page or the chamber's forecast. */
export function panelHref(p: Panel): string | null {
  if (p.raceId) return `/midterms/${p.raceId}`;
  if (p.office) return `/midterms/forecast/${p.office}`;
  return null;
}

