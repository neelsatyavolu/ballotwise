// Rendered inside the tracker's client components.
import Link from "next/link";
import { useContext, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EARLY_REPORTING, favoredSide, groupOf, isEarly, leaderOf, statusOf, tierOf, type Group, type Sort } from "@/lib/midterms/explore";
import { leadingFlip, outcomeOf } from "@/lib/midterms/holders";
import { stampET, stateFinal } from "@/lib/midterms/polls";
import { fmt, lead, signalLine, type RaceSummary } from "@/lib/midterms/view";
import { CandidateTable, lastName } from "./CandidateTable";
import { partyColor } from "./party";
import { shortLabel } from "./PollClose";
import { RailContext, useRailSplit } from "./railSplit";
import { RatingTag } from "./RaceCard";

const PAGE = 50;

const GROUP_LABEL: Record<Group, string> = {
  counting: "Counting",
  early: `Early counts, under ${EARLY_REPORTING}% reporting`,
  unknown: "Counting, reporting share unknown",
  awaiting: "No votes yet",
  called: "Called, latest first",
};

export type Stars = { ids: number[] | null; toggle: (id: number) => void };

/** Candidates shown on a card; the rest are a link away. */
const CARD_CANDIDATES = 3;


function Tier({ race }: { race: RaceSummary }) {
  if (race.rating) return <RatingTag rating={race.rating} signal={race.signal} />;
  const side = favoredSide(race);
  if (tierOf(race) === "safe") return <span className="mt-rating r-safe" title={signalLine(race.signal, race) ?? undefined}>Safe{side ? ` ${side}` : ""}</span>;
  return race.office === "measure" ? null : <span className="mt-rating r-none" title="No market or poll covers this race">Unrated</span>;
}

/** What moved in about the last 15 minutes: votes added (negative is a correction), and how the lead changed. */
function TrendLine({ race, now }: { race: RaceSummary; now: number }) {
  const t = race.trend;
  if (!t || race.candidates.some((c) => c.winner)) return null;
  const ahead = lead(race.candidates);
  const parts: string[] = [];
  const at = stampET(t.since);
  if (t.votesAdded) parts.push(t.votesAdded > 0 ? `${fmt(t.votesAdded)} more votes since ${at}` : `${fmt(-t.votesAdded)} fewer votes since ${at} (a correction)`);
  if (ahead && t.prevLeader && t.prevLeader !== ahead.leader.name) parts.push(`${lastName(t.prevLeader)} led then`);
  else if (ahead && t.prevMargin !== null && Math.abs(t.prevMargin - ahead.margin) >= 0.1) parts.push(`lead was ${t.prevMargin.toFixed(1)} then`);
  const minutes = Math.max(0, Math.round((now - t.lastChange) / 60_000));
  const title = `Compared with the count Ballotwise saved at ${at}. Ballotwise saves a race's count at most every five minutes (right away for a correction or a new leader); the last save was ${minutes < 1 ? "just now" : `${minutes} minutes ago`}.`;
  parts.push(minutes < 1 ? "saved just now" : `last saved ${minutes}m ago`);
  return <span className="mt-res-trend" title={title}>{parts.join(" · ")}</span>;
}

function Status({ race, now }: { race: RaceSummary; now: number }) {
  return (
    <>
      <StatusText race={race} now={now} />
      {race.missing && <span className="mt-flag warn" title="civicAPI left this race out of its latest answer; these are the last numbers we saw">{race.lastSeen ? `Not updated · numbers as of ${stampET(race.lastSeen)}` : "Not updated"}</span>}
    </>
  );
}

function StatusText({ race, now }: { race: RaceSummary; now: number }) {
  if (race.callPending) return <span className="mt-res-status" title="The call log and the latest count disagree for a moment; this settles on the next update">Call status updating</span>;
  const status = statusOf(race);
  if (status === "called") {
    const o = outcomeOf(race);
    return (
      <span className="mt-res-status called" title="Called by civicAPI's decision desk; the time is when Ballotwise first saw the call">
        {race.call ? `Call seen ${stampET(race.call.at)}` : "Called"}
        {o && <span className={`mt-flag${o.gain ? ` gain p-${o.side}` : ""}`}>{o.side} {o.gain ? "gain" : "hold"}</span>}
      </span>
    );
  }
  if (race.call?.withdrawn) return <span className="mt-res-status warn">Call withdrawn {stampET(race.call.at)}</span>;
  if (status === "counting") {
    const flip = leadingFlip(race);
    return (
      <span className="mt-res-status">
        Counting
        {isEarly(race) && <span className="mt-flag" title={`Under ${EARLY_REPORTING}% reporting: early leads often change`}>Early</span>}
        {flip && <span className={`mt-flag lead p-${flip}`} title="Leading for a different party than holds the seat; not a call">{flip} leads flip</span>}
      </span>
    );
  }
  const final = stateFinal(race.state);
  return <span className="mt-res-status muted" title="When the state's last scheduled polls close; some districts may close earlier">{final && final > now ? `Polls close ${stampET(final)} ET` : "Awaiting votes"}</span>;
}

/** The lead as a solid party-colored badge ("+4.21% Smith") and the gap in votes. */
function Lead({ race }: { race: RaceSummary }) {
  const ahead = lead(race.candidates);
  const second = race.candidates[1];
  if (!ahead || ahead.margin <= 0) return null;
  return (
    <span className="mt-tile-lead">
      <b className="mt-margin" style={{ background: partyColor(ahead.leader) }}>
        +{ahead.margin.toFixed(2)}% {race.office === "measure" ? ahead.leader.name : lastName(ahead.leader.name)}
      </b>
      {second && <span className="muted">{fmt(ahead.leader.votes - second.votes)} votes</span>}
    </span>
  );
}

/** One race as a results card: name and rating, the candidates' table, then status, lead and how much is in. */
function RaceTile({ race, starred, onStar, now }: { race: RaceSummary; starred: boolean; onStar: () => void; now: number }) {
  const leader = leaderOf(race);
  const sub = race.about?.text ?? (race.total ? null : signalLine(race.signal, race));
  return (
    <article className={`mt-tile s-${statusOf(race)}${leader ? ` p-${leader}` : ""}`} aria-label={shortLabel(race)}>
      {race.total > 0 && (
        <span className="mt-tile-share" aria-hidden>
          {race.candidates.map((c) => <span key={c.name} style={{ width: `${c.pct}%`, background: partyColor(c), opacity: isEarly(race) ? 0.55 : 1 }} />)}
        </span>
      )}
      <header className="mt-tile-head">
        <div className="mt-tile-title">
          <Link href={`/midterms/${race.id}`}>{shortLabel(race)}</Link>
          {sub && <span className="mt-tile-sub" title={sub}>{sub}</span>}
        </div>
        <Tier race={race} />
        <button type="button" className={`mt-star sm${starred ? " on" : ""}`} aria-pressed={starred} aria-label={`Star ${shortLabel(race)}`} onClick={onStar}>
          {starred ? "★" : "☆"}
        </button>
      </header>
      <CandidateTable
        race={race}
        limit={CARD_CANDIDATES}
        short
        fill
        status={
          <span className="mt-tile-status">
            <Status race={race} now={now} />
            <Lead race={race} />
          </span>
        }
      />
      <footer className="mt-tile-foot">
        <TrendLine race={race} now={now} />
      </footer>
    </article>
  );
}

/** The filtered races as results cards in a grid, grouped by count status when sorted by closeness. */
export function ResultList({ races, stars, sort, now }: { races: RaceSummary[]; stars: Stars; sort: Sort; now: number }) {
  const [shown, setShown] = useState(PAGE);
  const beside = useRef<HTMLOListElement>(null);
  const { slot } = useContext(RailContext);
  const split = useRailSplit(beside, `${races.map((r) => r.id).join()}|${shown}|${sort}`);
  if (!races.length) return <p className="muted mt-res-empty">No races match these filters.</p>;
  const groupCounts = races.reduce((acc, r) => ({ ...acc, [groupOf(r)]: (acc[groupOf(r)] ?? 0) + 1 }), {} as Partial<Record<Group, number>>);
  const items = races.slice(0, shown).flatMap((r, i) => {
    const group = sort === "close" ? groupOf(r) : null;
    const header =
      group && (i === 0 || groupOf(races[i - 1]) !== group) ? (
        <li key={`g-${group}`} className="mt-res-group">
          {GROUP_LABEL[group]} · {groupCounts[group]}
        </li>
      ) : null;
    const tile = (
      <li key={r.id}>
        <RaceTile race={r} starred={!!stars.ids?.includes(r.id)} onStar={() => stars.toggle(r.id)} now={now} />
      </li>
    );
    return header ? [header, tile] : [tile];
  });
  // Cards past the end of election mode's side rail move to a full-width grid under the layout.
  const wide = split !== null && slot ? items.slice(split) : [];
  const more = races.length > shown && (
    <button type="button" className="btn secondary mt-res-more" onClick={() => setShown((n) => n + PAGE)}>
      Show {Math.min(PAGE, races.length - shown)} more of {races.length - shown}
    </button>
  );
  return (
    <div className="mt-res">
      <ol ref={beside} className="mt-res-grid" aria-label="Races">
        {wide.length ? items.slice(0, split!) : items}
      </ol>
      {wide.length && slot ? (
        createPortal(
          <>
            <ol className="mt-res-grid" aria-label="More races">
              {wide}
            </ol>
            {more}
          </>,
          slot,
        )
      ) : (
        more
      )}
    </div>
  );
}
