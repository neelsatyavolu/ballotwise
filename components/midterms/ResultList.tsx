// Rendered inside the tracker's client components.
import Link from "next/link";
import { useState } from "react";
import { EARLY_REPORTING, favoredSide, groupOf, isEarly, statusOf, tierOf, type Group, type Sort } from "@/lib/midterms/explore";
import { leadingFlip, outcomeOf } from "@/lib/midterms/holders";
import { stampET, stateFinal } from "@/lib/midterms/polls";
import { colorOf, fmt, lead, partyTag, signalLine, type RaceSummary } from "@/lib/midterms/view";
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

const lastName = (name: string) => {
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

function Candidates({ race }: { race: RaceSummary }) {
  const top = race.candidates.slice(0, 2);
  if (!race.total) {
    return (
      <div className="mt-res-cands">
        {top.map((c) => (
          <span key={c.name} title={c.name}>
            <span className="swatch" style={{ background: colorOf(c) }} aria-hidden /> {race.office === "measure" ? c.name : lastName(c.name)}
            {partyTag(c.party) && <span className="muted"> {partyTag(c.party)}</span>}
            {c.incumbent && <span className="muted" title="Incumbent">*</span>}
          </span>
        ))}
        {signalLine(race.signal) && <span className="muted small">{signalLine(race.signal)}</span>}
      </div>
    );
  }
  return (
    <div className="mt-res-cands">
      {top.map((c) => (
        <span key={c.name} title={c.name} className={c.winner ? "won" : undefined}>
          <span className="swatch" style={{ background: colorOf(c) }} aria-hidden /> {race.office === "measure" ? c.name : lastName(c.name)}
          {partyTag(c.party) && <span className="muted"> {partyTag(c.party)}</span>}
          {c.incumbent && <span className="muted" title="Incumbent">*</span>}
          <b className="num"> {c.pct.toFixed(1)}%</b>
          {c.winner && <span className="mt-check" aria-label="winner"> ✓</span>}
        </span>
      ))}
      <span className="mt-stack" aria-hidden>
        {race.candidates.map((c) => <span key={c.name} style={{ width: `${c.pct}%`, background: colorOf(c), opacity: isEarly(race) ? 0.55 : 1 }} />)}
      </span>
    </div>
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

function SortHead({ label, sort, by, onSort, className }: { label: string; sort: Sort; by: Sort; onSort: (s: Sort) => void; className?: string }) {
  return (
    <span className={className} role="columnheader" aria-sort={sort !== by ? "none" : by === "state" ? "ascending" : by === "close" ? "other" : "descending"}>
      <button type="button" onClick={() => onSort(by)} className={sort === by ? "on" : undefined}>
        {label}
        {sort === by && " ▾"}
      </button>
    </span>
  );
}

/** The filtered races as dense rows: rating, the top two with shares, the lead in points and votes, how much is in, and status. */
export function ResultList({ races, stars, sort, onSort, now }: { races: RaceSummary[]; stars: Stars; sort: Sort; onSort: (s: Sort) => void; now: number }) {
  const [shown, setShown] = useState(PAGE);
  if (!races.length) return <p className="muted mt-res-empty">No races match these filters.</p>;
  const groupCounts = races.reduce((acc, r) => ({ ...acc, [groupOf(r)]: (acc[groupOf(r)] ?? 0) + 1 }), {} as Partial<Record<Group, number>>);
  return (
    <div className="mt-res" role="table" aria-label="Races" aria-rowcount={races.length}>
      <div className="mt-res-row mt-res-head" role="row">
        <span role="columnheader" aria-label="Star" />
        <SortHead label="Race" sort={sort} by="state" onSort={onSort} />
        <span role="columnheader">Candidates</span>
        <SortHead label="Lead" sort={sort} by="close" onSort={onSort} className="num" />
        <SortHead label="Reporting" sort={sort} by="reporting" onSort={onSort} className="num" />
        <SortHead label="Status" sort={sort} by="called" onSort={onSort} />
      </div>
      {races.slice(0, shown).map((r, i) => {
        const group = sort === "close" ? groupOf(r) : null;
        const header = group && (i === 0 || groupOf(races[i - 1]) !== group) ? (
          <div key={`g-${group}`} className="mt-res-group" role="row">
            <span role="cell">{GROUP_LABEL[group]} · {groupCounts[group]}</span>
          </div>
        ) : null;
        const ahead = lead(r.candidates);
        const second = r.candidates[1];
        const starred = !!stars.ids?.includes(r.id);
        return (
          [header, <div key={r.id} className={`mt-res-row s-${statusOf(r)}`} role="row">
            <span role="cell">
              <button type="button" className={`mt-star sm${starred ? " on" : ""}`} aria-pressed={starred} aria-label={`Star ${shortLabel(r)}`} onClick={() => stars.toggle(r.id)}>
                {starred ? "★" : "☆"}
              </button>
            </span>
            <span role="cell" className="mt-res-race">
              <Link href={`/midterms/${r.id}`}>{shortLabel(r)}</Link>
              <Tier race={r} />
              {r.about && <span className="mt-row-about" title={r.about.text}>{r.about.text}</span>}
            </span>
            <span role="cell">
              <Candidates race={r} />
              <TrendLine race={r} now={now} />
            </span>
            <span role="cell" className="num mt-res-lead">
              {ahead && ahead.margin > 0 ? (
                <>
                  <b style={{ color: colorOf(ahead.leader) }}>+{ahead.margin.toFixed(1)}</b>
                  {second && <span className="muted small">{fmt(ahead.leader.votes - second.votes)} votes</span>}
                </>
              ) : (
                <span className="muted">—</span>
              )}
            </span>
            <span role="cell" className="num mt-res-in" title={r.reportingUnknown ? "civicAPI has votes for this race but no reporting figure" : "civicAPI's estimate of precincts or ballot batches reported. Not the share of the expected vote."}>
              {r.total > 0 && !r.reportingUnknown ? (
                <>
                  {Math.round(r.reporting)}%<span className="mt-res-inlabel"> reporting</span>
                  <span className="mt-res-inbar" aria-hidden><span style={{ width: `${Math.min(100, r.reporting)}%` }} /></span>
                </>
              ) : (
                <span className="muted">{r.reportingUnknown ? "Unknown" : "—"}</span>
              )}
            </span>
            <span role="cell"><Status race={r} now={now} /></span>
          </div>]
        );
      })}
      {races.length > shown && (
        <button type="button" className="btn secondary mt-res-more" onClick={() => setShown((n) => n + PAGE)}>
          Show {Math.min(PAGE, races.length - shown)} more of {races.length - shown}
        </button>
      )}
    </div>
  );
}
