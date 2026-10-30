// Rendered inside the tracker's map tooltips.
import { flipTo, isWatch, safeSide } from "@/lib/midterms/explore";
import { holderOf } from "@/lib/midterms/holders";
import { chances, partyOf, RATING_LABEL, ratingFill, safeFill, STATE_NAMES, type RaceSummary } from "@/lib/midterms/view";
import { partyColor } from "./party";

const ORDINAL = new Intl.PluralRules("en-US", { type: "ordinal" });
const SUFFIX: Record<string, string> = { one: "st", two: "nd", few: "rd", other: "th" };

/** "New Mexico", "New Mexico (special)", or "Utah's 3rd District" / "Wyoming's At-Large District". */
function forecastTitle(r: RaceSummary): string {
  const state = STATE_NAMES[r.state] ?? r.state;
  if (r.office !== "house") return /special/i.test(r.title) ? `${state} (special)` : state;
  const d = r.district ?? 0;
  return `${state}'s ${d === 0 ? "At-Large" : `${d}${SUFFIX[ORDINAL.select(d)]}`} District`;
}

/**
 * Each candidate's win probability from the forecast. A side's chance goes to its first candidate only, so a race
 * with two Democrats (California's top two) doesn't show the party's chance twice.
 */
function candidateOdds(r: RaceSummary): { name: string; party: string; incumbent: boolean; p: number | null }[] {
  const odds = chances(r.signal) ?? {};
  const used = new Set<string>();
  return r.candidates
    .map((c) => {
      const p = partyOf(c.party);
      const side = p === "other" ? "I" : p;
      const chance = used.has(side) ? undefined : odds[side];
      if (chance !== undefined) used.add(side);
      return { name: c.name, party: c.party, incumbent: c.incumbent, p: chance ?? null };
    })
    .sort((a, b) => (b.p ?? -1) - (a.p ?? -1));
}

const STAMP = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The pre-vote map tooltip, after DDHQ's forecast card: candidates with win chances, and the rating as a pill. */
export function ForecastTip({ race, updatedAt }: { race: RaceSummary; updatedAt: number | null }) {
  const rows = candidateOdds(race);
  const priced = rows.filter((c) => c.p !== null);
  const shown = (priced.length ? priced : rows).slice(0, 3);
  const safe = race.rating ? null : safeSide(race);
  const label = race.rating ? RATING_LABEL[race.rating] : safe ? `Safe ${safe}` : null;
  const fill = race.rating ? ratingFill(race.rating) : safe ? safeFill(safe) : null;
  const holder = holderOf(race);
  const flip = holder && flipTo(race);
  return (
    <div className="mt-ft">
      <div className="mt-ft-head">
        <div className="mt-ft-title">
          <b>{forecastTitle(race)}</b>
          {/* After DDHQ: the seat's current party, then the party the forecast favors to take it. */}
          {flip && (
            <span className={`mt-ft-flip from-${holder} to-${flip}`} aria-label={`Projected to flip from ${holder} to ${flip}`}>
              <i>{holder}</i> → <i>{flip}</i>
            </span>
          )}
        </div>
        <span>Probability</span>
        <span>Rating</span>
      </div>
      <div className="mt-ft-body">
        <ul className="mt-ft-rows">
          {shown.map((c) => (
            <li key={c.name} style={{ borderLeftColor: partyColor(c) }}>
              <span className="mt-ft-name">
                {c.name}
                {c.incumbent && "*"}
              </span>
              <span className="mt-ft-p">{c.p === null ? "—" : `${Math.round(c.p * 100)}%`}</span>
            </li>
          ))}
        </ul>
        {label && (
          <span className={`mt-ft-pill${race.rating === "tossup" ? " tossup" : ""}`} style={{ background: fill ?? undefined }}>
            {label}
          </span>
        )}
      </div>
      {updatedAt && <div className="mt-ft-foot">Last updated {STAMP.format(updatedAt)}</div>}
    </div>
  );
}

/** On election night, the line that flags a race the forecast rated a toss-up and that hasn't been called. */
export function WatchNote({ race }: { race: RaceSummary }) {
  return isWatch(race) ? <div className="mt-watch-note">Pre-election toss-up · one to watch</div> : null;
}
