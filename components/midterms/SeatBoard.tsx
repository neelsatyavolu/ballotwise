// Rendered inside the tracker's client components.
import Link from "next/link";
import { useMemo } from "react";
import { EARLY_REPORTING, favoredSide, isCompetitive, isEarly, isWatch, statusOf, tierOf } from "@/lib/midterms/explore";
import { holderOf, outcomeOf } from "@/lib/midterms/holders";
import { clockNow } from "@/lib/midterms/clock";
import { electionModeDefault } from "@/lib/midterms/polls";
import { colorOf, lead, partyOf, partyTag, raceLabel, safeFill, STATE_NAMES, type RaceSummary } from "@/lib/midterms/view";

/** Results shows the count (uncounted seats grey on election night); Ratings shows only the pre-election rating. */
export type FillMode = "results" | "ratings";

const PARTY_VAR = { D: "var(--dem)", R: "var(--rep)", I: "var(--oth)" } as const;

const TIER_STRENGTH = { lean: 42, likely: 26, safe: 12 } as const;

/** The rating color: the side markets or polls favor, fainter the safer; toss-ups gold; unrated neutral. */
function ratingColor(r: RaceSummary): string {
  const tier = tierOf(r);
  if (tier === "tossup") return "var(--tossup)";
  const side = favoredSide(r);
  if (!side || tier === "unrated") return "var(--rule-strong)";
  return `color-mix(in srgb, ${PARTY_VAR[side]} ${TIER_STRENGTH[tier]}%, var(--sheet))`;
}

/** The called winner, unless the call log hasn't caught up with civicAPI's flag yet (then the race isn't shown as called). */
export function calledWinner(r: RaceSummary) {
  if (r.callPending) return undefined;
  // The overview's `calledFor` comes from the call log itself; older payloads without it fall back to the winner flag.
  if (r.calledFor !== undefined) return r.calledFor === null ? undefined : r.candidates.find((c) => c.name === r.calledFor);
  return r.candidates.find((c) => c.winner);
}

/** A called seat's color: the same full party colors every map uses for a call. */
function calledFill(won: { name: string; party: string }): string {
  const p = partyOf(won.party);
  return p === "other" ? colorOf(won) : safeFill(p);
}

/** Plain grey for a seat with no votes yet on election night, so nothing uncounted reads as a result. */
export const NO_VOTES_FILL = "var(--rule-strong)";

/**
 * A seat's background. In results: called solid, leading lighter (palest on early counts), tied neutral. From
 * election day, or once counting has begun anywhere, seats with no votes are plain grey; ratings live in Ratings mode.
 */
export function seatFill(r: RaceSummary, mode: FillMode = "results", counting = false, flat = false): string {
  if (mode === "ratings") return ratingColor(r);
  const won = calledWinner(r);
  if (won) return calledFill(won);
  const ahead = lead(r.candidates);
  if (ahead && ahead.margin > 0) return `color-mix(in srgb, ${colorOf(ahead.leader)} ${isEarly(r) ? 25 : 50}%, var(--sheet))`;
  if (ahead) return "var(--sheet)";
  if (!counting && !electionModeDefault(clockNow())) return ratingColor(r);
  return flat ? NO_VOTES_FILL : `color-mix(in srgb, var(--rule-strong) 70%, var(--sheet))`;
}

/** A seat in words, for tooltips and screen readers. */
export function seatSummary(r: RaceSummary): string {
  const won = r.candidates.find((c) => c.winner);
  const outcome = outcomeOf(r);
  if (won) return `${raceLabel(r)}: ${won.name} (${partyTag(won.party) || "other"}) won${outcome ? `, ${outcome.side} ${outcome.gain ? "gain" : "hold"}` : ""}`;
  const ahead = lead(r.candidates);
  if (ahead && ahead.margin > 0) return `${raceLabel(r)}: ${ahead.leader.name} (${partyTag(ahead.leader.party) || "other"}) leads by ${ahead.margin.toFixed(1)}, ${r.reportingUnknown ? "reporting unknown" : `${Math.round(r.reporting)}% reporting`}`;
  if (ahead) return `${raceLabel(r)}: tied`;
  const holder = holderOf(r);
  return `${raceLabel(r)}: ${statusOf(r) === "awaiting" ? "no votes yet" : "counting"}${r.rating ? `, rated ${r.rating.replace("-", " ").replace("tossup", "toss-up")}` : ""}${holder ? `, held by ${holder}` : ""}`;
}

/** What the seat and state colors mean: ratings before any votes, results after. */
export function FillLegend({ counted, mode, gains = false, flat = false }: { counted: boolean; mode: FillMode; gains?: boolean; flat?: boolean }) {
  const mix = (v: string, n: number) => `color-mix(in srgb, ${v} ${n}%, var(--sheet))`;
  // Election night shows the results key even before the first votes, since the map is already grey then.
  if ((!counted && !electionModeDefault(clockNow())) || mode === "ratings") {
    return (
      <p className="muted small mt-legend">
        <span><i style={{ background: "var(--tossup)" }} />Toss-up</span>
        <span><i style={{ background: mix("var(--dem)", TIER_STRENGTH.lean) }} /><i style={{ background: mix("var(--rep)", TIER_STRENGTH.lean) }} />Lean</span>
        <span><i style={{ background: mix("var(--dem)", TIER_STRENGTH.likely) }} /><i style={{ background: mix("var(--rep)", TIER_STRENGTH.likely) }} />Likely</span>
        <span><i style={{ background: mix("var(--dem)", TIER_STRENGTH.safe) }} /><i style={{ background: mix("var(--rep)", TIER_STRENGTH.safe) }} />Safe</span>
        <span><i style={{ background: "var(--rule-strong)" }} />No market or polls</span>
        <span>Ratings from market odds or polling, before any votes.</span>
      </p>
    );
  }
  return (
    <p className="muted small mt-legend">
      <span><i style={{ background: "var(--rate-safe-d)" }} />D won</span>
      <span><i style={{ background: mix("var(--dem)", 50) }} />D leads</span>
      <span><i style={{ background: "var(--rate-safe-r)" }} />R won</span>
      <span><i style={{ background: mix("var(--rep)", 50) }} />R leads</span>
      <span><i style={{ background: "var(--sheet)", boxShadow: "inset 0 0 0 1px var(--rule-strong)" }} />Tied</span>
      <span><i style={{ background: flat ? NO_VOTES_FILL : "color-mix(in srgb, var(--rule-strong) 70%, var(--sheet))" }} />No votes yet</span>
      <span><i className="watch" />Pre-election toss-up still uncalled</span>
      <span><i className="watch lean" />Lean, still uncalled</span>
      {flat && <span><i style={{ background: "color-mix(in srgb, var(--rule) 45%, var(--sheet))" }} />No race</span>}
      {gains && <span><i className="ring" />Changed party</span>}
      <span>Leads under {EARLY_REPORTING}% reporting stay pale, a display choice rather than a confidence threshold. Switch to Ratings to see the pre-election picture.</span>
    </p>
  );
}

/** All 435 House seats as tiles, grouped by state. Tap a seat to open it; tap a state to filter to it. */
export function SeatBoard({ races, selected, onState, matching, mode }: { races: readonly RaceSummary[]; selected: readonly string[]; onState: (state: string) => void; matching: ReadonlySet<number>; mode: FillMode }) {
  const byState = useMemo(() => {
    const m = new Map<string, RaceSummary[]>();
    for (const r of races) if (r.office === "house") m.set(r.state, [...(m.get(r.state) ?? []), r]);
    return [...m.entries()].map(([state, list]) => [state, list.sort((a, b) => (a.district ?? 0) - (b.district ?? 0))] as const).sort((a, b) => (STATE_NAMES[a[0]] ?? a[0]).localeCompare(STATE_NAMES[b[0]] ?? b[0]));
  }, [races]);

  const total = races.filter((r) => r.office === "house").length;
  const shown = races.filter((r) => r.office === "house" && matching.has(r.id)).length;
  const counting = races.some((r) => r.office === "house" && r.total > 0);
  return (
    <section className="mt-board" aria-label="Every House seat, a visual summary. Every seat is also in the race list.">
      <p className="muted small mt-board-note">{shown === total ? `All ${total} seats` : `${shown} of ${total} seats match the filters; the rest are dimmed`}{total !== 435 ? ` (civicAPI lists ${total} of 435)` : ""}. Tap a seat to open it, a state to filter.</p>
      <div className="mt-board-grid">
        {byState.map(([state, list]) => (
          <div key={state} className={`mt-board-state${selected.includes(state) ? " on" : ""}`}>
            <button type="button" className="mt-board-name" aria-pressed={selected.includes(state)} onClick={() => onState(state)} title={`Show only ${STATE_NAMES[state] ?? state}`}>
              {state}
            </button>
            <div className="mt-board-seats">
              {list.map((r) => (
                <Link key={r.id} href={`/midterms/${r.id}`} tabIndex={-1} className={`mt-seat${outcomeOf(r)?.gain ? " gain" : ""}${isWatch(r) ? " watch" : isCompetitive(r) ? " lean" : ""}${matching.has(r.id) ? "" : " dim"}`} style={{ background: seatFill(r, mode, counting) }} aria-label={seatSummary(r)} title={seatSummary(r)}>
                  {r.district || "AL"}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
      <FillLegend counted={counting} mode={mode} gains />
    </section>
  );
}
