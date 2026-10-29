// Rendered inside the tracker's client components.
import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { EARLY_REPORTING, favoredSide, groupOf, isEarly, leaderOf, statusOf, tierOf, type Group, type Sort } from "@/lib/midterms/explore";
import { leadingFlip, outcomeOf } from "@/lib/midterms/holders";
import { stampET, stateFinal } from "@/lib/midterms/polls";
import { fmt, lead, partyTag, signalLine, type RaceSummary } from "@/lib/midterms/view";
import { partyColor } from "./party";
import { shortLabel } from "./PollClose";
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

export const lastName = (name: string) => {
  const parts = name.replace(/,? (Jr|Sr|II|III|IV)\.?$/i, "").split(" ");
  // "de la Cruz", "Van Hollen": keep lowercase particles with the surname.
  let i = parts.length - 1;
  while (i > 0 && /^(de|la|van|von|del|da|di|le)$/i.test(parts[i - 1])) i -= 1;
  return parts.slice(i).join(" ");
};

function Tier({ race }: { race: RaceSummary }) {
  if (race.rating) return <RatingTag rating={race.rating} signal={race.signal} />;
  const side = favoredSide(race);
  if (tierOf(race) === "safe") return <span className="mt-rating r-safe" title={signalLine(race.signal) ?? undefined}>Safe{side ? ` ${side}` : ""}</span>;
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

type Cand = RaceSummary["candidates"][number];

/** Party as a results desk abbreviates it: DEM, GOP, LIB, GRE, IND, or the party's own short tag. */
function partyCode(party: string): string {
  if (/^Democrat/i.test(party)) return "DEM";
  if (/^Republican/i.test(party)) return "GOP";
  if (/libertarian/i.test(party)) return "LIB";
  if (/green/i.test(party)) return "GRE";
  if (/independent/i.test(party)) return "IND";
  return partyTag(party).toUpperCase();
}

const initials = (name: string) => {
  const parts = name.replace(/[^\p{L}\s'-]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + lastName(name)[0]).toUpperCase();
};

/** The race's candidates as a small results table: party bar, initials, party, votes and share. */
function Candidates({ race }: { race: RaceSummary }) {
  const measure = race.office === "measure";
  const shown = race.candidates.slice(0, CARD_CANDIDATES);
  const hidden = race.candidates.length - shown.length;
  const early = isEarly(race);
  return (
    <table className="mt-tile-table">
      <thead>
        <tr>
          <th scope="col">{measure ? "Choice" : "Candidate"}</th>
          {!measure && <th scope="col">Party</th>}
          <th scope="col" className="num">Votes</th>
          <th scope="col" className="num">Pct</th>
        </tr>
      </thead>
      <tbody>
        {shown.map((c: Cand) => (
          <tr key={c.name} className={c.winner ? "won" : undefined} style={{ "--p": partyColor(c), opacity: early && !c.winner ? 0.85 : undefined } as CSSProperties}>
            <td title={c.name}>
              {!measure && <span className="mt-av" aria-hidden>{initials(c.name)}</span>}
              <span className="mt-tile-name">{measure ? c.name : lastName(c.name)}</span>
              {c.incumbent && <span title="Incumbent">*</span>}
              {c.winner && <span className="mt-check" aria-label="winner"> ✓</span>}
            </td>
            {!measure && <td className="mt-tile-party">{partyCode(c.party)}</td>}
            <td className="num">{fmt(c.votes)}</td>
            <td className="num">{c.pct.toFixed(2)}%</td>
          </tr>
        ))}
        {hidden > 0 && (
          <tr className="mt-tile-more">
            <td colSpan={measure ? 3 : 4}>
              <Link href={`/midterms/${race.id}`}>+{hidden} more</Link>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
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

const SORTS: { by: Sort; label: string }[] = [
  { by: "state", label: "Race" },
  { by: "close", label: "Lead" },
  { by: "reporting", label: "Reporting" },
  { by: "called", label: "Status" },
];

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

/** How much of the count is in, as a percentage over a thin track. */
function Reporting({ race }: { race: RaceSummary }) {
  const unknown = race.total > 0 && race.reportingUnknown;
  const pct = race.total > 0 && !unknown ? Math.min(100, race.reporting) : 0;
  return (
    <div className="mt-tile-in" title={unknown ? "civicAPI has votes for this race but no reporting figure" : "civicAPI's estimate of precincts or ballot batches reported. Not the share of the expected vote."}>
      <span className="num">{unknown ? "Reporting unknown" : `${Math.round(pct)}%`}</span>
      <span className="mt-tile-track" aria-hidden><span style={{ width: `${pct}%` }} /></span>
    </div>
  );
}

/** One race as a results card: name and rating, the candidates' table, then status, lead and how much is in. */
function RaceTile({ race, starred, onStar, now }: { race: RaceSummary; starred: boolean; onStar: () => void; now: number }) {
  const leader = leaderOf(race);
  const sub = race.about?.text ?? (race.total ? null : signalLine(race.signal));
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
      <Candidates race={race} />
      <footer className="mt-tile-foot">
        <div className="mt-tile-status">
          <Status race={race} now={now} />
          <Lead race={race} />
        </div>
        <TrendLine race={race} now={now} />
        <Reporting race={race} />
      </footer>
    </article>
  );
}

/** The filtered races as results cards in a grid, grouped by count status when sorted by closeness. */
export function ResultList({ races, stars, sort, onSort, now }: { races: RaceSummary[]; stars: Stars; sort: Sort; onSort: (s: Sort) => void; now: number }) {
  const [shown, setShown] = useState(PAGE);
  if (!races.length) return <p className="muted mt-res-empty">No races match these filters.</p>;
  const groupCounts = races.reduce((acc, r) => ({ ...acc, [groupOf(r)]: (acc[groupOf(r)] ?? 0) + 1 }), {} as Partial<Record<Group, number>>);
  return (
    <div className="mt-res">
      <div className="mt-res-sort" role="group" aria-label="Sort races by">
        <span className="mt-res-sort-label">Sort</span>
        {SORTS.map((s) => (
          <button key={s.by} type="button" aria-pressed={sort === s.by} onClick={() => onSort(s.by)}>
            {s.label}
            {sort === s.by && " ▾"}
          </button>
        ))}
      </div>
      <ol className="mt-res-grid" aria-label="Races">
        {races.slice(0, shown).map((r, i) => {
          const group = sort === "close" ? groupOf(r) : null;
          const header = group && (i === 0 || groupOf(races[i - 1]) !== group) ? (
            <li key={`g-${group}`} className="mt-res-group">
              {GROUP_LABEL[group]} · {groupCounts[group]}
            </li>
          ) : null;
          return [
            header,
            <li key={r.id}>
              <RaceTile race={r} starred={!!stars.ids?.includes(r.id)} onStar={() => stars.toggle(r.id)} now={now} />
            </li>,
          ];
        })}
      </ol>
      {races.length > shown && (
        <button type="button" className="btn secondary mt-res-more" onClick={() => setShown((n) => n + PAGE)}>
          Show {Math.min(PAGE, races.length - shown)} more of {races.length - shown}
        </button>
      )}
    </div>
  );
}
