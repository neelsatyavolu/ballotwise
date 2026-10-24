// Rendered inside the tracker's client components.
import { useMemo, type ReactNode } from "react";
import { isCalled, statusOf } from "@/lib/midterms/explore";
import { measureCount, OFFICE_LABEL, STATE_NAMES, type Office, type RaceSummary } from "@/lib/midterms/view";
import { NationMap } from "./maps";
import { FillLegend, seatFill, seatSummary, type FillMode } from "./SeatBoard";

type Fill = { fill: string; tip: ReactNode; label: string };

/** Specials sort after a state's regular race, so the regular one colors the state. */
const regularFirst = (a: RaceSummary, b: RaceSummary) => Number(/special/i.test(a.title)) - Number(/special/i.test(b.title));

function statewideFills(races: RaceSummary[], mode: FillMode, counting: boolean): Map<string, Fill> {
  const byState = new Map<string, RaceSummary[]>();
  for (const r of races) byState.set(r.state, [...(byState.get(r.state) ?? []), r]);
  const out = new Map<string, Fill>();
  for (const [state, list] of byState) {
    const sorted = [...list].sort(regularFirst);
    const lines = sorted.map(seatSummary);
    out.set(state, { fill: seatFill(sorted[0], mode, counting, true), label: lines.join("; "), tip: <>{lines.map((l) => <div key={l}>{l}</div>)}</> });
  }
  return out;
}

function measureFills(races: RaceSummary[]): Map<string, Fill> {
  const byState = new Map<string, RaceSummary[]>();
  for (const r of races) byState.set(r.state, [...(byState.get(r.state) ?? []), r]);
  const out = new Map<string, Fill>();
  for (const [state, list] of byState) {
    const c = measureCount(list);
    const counting = list.filter((r) => statusOf(r) === "counting").length;
    const decided = list.every(isCalled);
    const label = `${list.length} ${list.length === 1 ? "measure" : "measures"}: ${c.passed} passed, ${c.failed} failed, ${counting} counting`;
    out.set(state, {
      fill: decided ? "color-mix(in srgb, var(--ink) 40%, var(--sheet))" : counting ? "color-mix(in srgb, var(--accent) 55%, var(--sheet))" : "color-mix(in srgb, var(--accent) 18%, var(--sheet))",
      label,
      tip: <><b>{STATE_NAMES[state] ?? state}</b><div>{label}</div></>,
    });
  }
  return out;
}

function Legend({ office, counted, mode }: { office: Office; counted: boolean; mode: FillMode }) {
  if (office !== "measure") return <FillLegend counted={counted} mode={mode} flat />;
  return (
    <p className="muted small mt-legend">
      <span><i style={{ background: "color-mix(in srgb, var(--accent) 18%, var(--sheet))" }} />No votes yet</span>
      <span><i style={{ background: "color-mix(in srgb, var(--accent) 55%, var(--sheet))" }} />Counting</span>
      <span><i style={{ background: "color-mix(in srgb, var(--ink) 40%, var(--sheet))" }} />All decided</span>
    </p>
  );
}

/** The nation for one statewide office (or measures), shaded the same way as the House seat board. Picking a state filters to it. */
export function ElectionMap({ office, races, selected, onState, mode }: { office: Office; races: readonly RaceSummary[]; selected: readonly string[]; onState: (state: string) => void; mode: FillMode }) {
  const mine = useMemo(() => races.filter((r) => r.office === office), [races, office]);
  const counting = mine.some((r) => r.total > 0);
  const fills = useMemo(() => (office === "measure" ? measureFills(mine) : statewideFills(mine, mode, counting)), [office, mine, mode, counting]);
  return (
    <section className="mt-el-map" aria-label={`${OFFICE_LABEL[office]} map`}>
      <NationMap fills={fills} selected={selected} label={`Map of 2026 ${OFFICE_LABEL[office].toLowerCase()} races. Pick a state to show only its races.`} onPick={onState} />
      <Legend office={office} counted={counting} mode={mode} />
    </section>
  );
}
