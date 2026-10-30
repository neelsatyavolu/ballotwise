// Pieces of the Early vote tab: shading, party bars, and one state's panel.
import type { Breakdown, Counts, EarlyCounty, EarlyStateDetail, PartySplit } from "@/lib/midterms/earlyVote";
import { shareOf2024 } from "@/lib/midterms/earlyVote";
import { fmt, marginLabel, pct } from "@/lib/midterms/view";
import { LeadCard } from "./EarlyVoteLead";

/** The share of the 2024 vote at which the map's shading tops out. */
const FULL_SHARE = 80;
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
export const dayLabel = (date: string) => DAY.format(new Date(`${date}T00:00:00Z`));

/** Map fill for ballots cast as a share of the 2024 vote, in the accent ramp the reporting map uses: turnout has no party. */
export function turnoutFill(share: number | null): string {
  if (share === null) return "var(--rule)";
  return `color-mix(in srgb, var(--accent) ${Math.round(12 + (Math.min(share, FULL_SHARE) / FULL_SHARE) * 80)}%, var(--sheet))`;
}

/** The legend's steps, matching turnoutFill. */
export function TurnoutLegend() {
  return (
    <div className="mt-legend" aria-label="Ballots cast as a share of the 2024 vote">
      {[0, 20, 40, 60, FULL_SHARE].map((s) => (
        <span key={s}>
          <i style={{ background: turnoutFill(s) }} />
          {s === FULL_SHARE ? `${s}%+` : `${s}%`}
        </span>
      ))}
      <span>of the 2024 vote cast so far</span>
    </div>
  );
}

const partyTotal = (p: PartySplit) => p.dem + p.rep + p.other;
/** The registration lead as "D+9.1", from each party's share of all ballots. */
export const partyLead = (p: PartySplit) => marginLabel(((p.dem - p.rep) / partyTotal(p)) * 100);

/** Registered Democrats, Republicans and everyone else, as one stacked bar with its shares. */
export function PartyBar({ party }: { party: PartySplit }) {
  const total = partyTotal(party);
  const parts = [
    { label: "Democrats", votes: party.dem, color: "var(--dem)" },
    { label: "Republicans", votes: party.rep, color: "var(--rep)" },
    { label: "Other or none", votes: party.other, color: "var(--muted)" },
  ];
  return (
    <div className="mt-ev-party">
      <div className="mt-ev-bar" aria-hidden>
        {parts.map((p) => p.votes > 0 && <span key={p.label} style={{ width: `${(p.votes / total) * 100}%`, background: p.color }} />)}
      </div>
      <div className="mt-legend">
        {parts.map((p) => (
          <span key={p.label}>
            <i style={{ background: p.color }} />
            {p.label} <b>{pct((p.votes / total) * 100)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/** The headline counts for the nation or a state. */
export function Stats({ counts, base2024 }: { counts: Counts; base2024?: number | null }) {
  const share = base2024 === undefined ? null : shareOf2024(counts.cast, base2024);
  const outstanding = counts.requested - counts.returned;
  const stats = [
    { label: "Ballots cast", value: fmt(counts.cast), lead: true },
    share !== null && { label: "Of the 2024 vote", value: pct(share) },
    // A zero here usually means the state doesn't report that kind of ballot, not that none were cast.
    counts.returned > 0 && { label: "Mail returned", value: fmt(counts.returned) },
    counts.inperson > 0 && { label: "In person", value: fmt(counts.inperson) },
    outstanding > 0 && { label: "Mail not back yet", value: fmt(outstanding) },
  ].filter((s): s is { label: string; value: string; lead?: boolean } => !!s);
  return (
    <dl className="mt-ev-stats">
      {stats.map((s) => (
        <div key={s.label} className={s.lead ? "lead" : undefined}>
          <dt>{s.label}</dt>
          <dd>{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * This year against the same day in 2024. All early ballots are compared, not mail and in-person apart: states
 * filed them differently in 2024 (North Carolina's "returned" file holds its in-person early votes too).
 */
function VersusPrior({ detail }: { detail: EarlyStateDetail }) {
  const prior = detail.prior;
  if (!prior || prior.cast === 0) return null;
  const change = ((detail.cast - prior.cast) / prior.cast) * 100;
  return (
    <section className="mt-ev-block" aria-labelledby="ev-prior">
      <h3 id="ev-prior">Against 2024</h3>
      <p className="small">
        {fmt(detail.cast)} early ballots so far, against {fmt(prior.cast)} by {dayLabel(prior.date)}, 2024, the same day before that election:{" "}
        <b>{change >= 0 ? `${pct(change)} more` : `${pct(-change)} fewer`}</b>.
        {detail.party && prior.party && (
          <>
            {" "}
            Registration lead {partyLead(prior.party)} then, <b>{partyLead(detail.party)}</b> now.
          </>
        )}
      </p>
      <p className="muted small">2024 was a presidential year, so midterm turnout usually trails it.</p>
    </section>
  );
}

function BreakdownBars({ title, rows }: { title: string; rows: Breakdown }) {
  const total = rows.reduce((n, r) => n + r.votes, 0);
  return (
    <div className="mt-ev-demo">
      <h4>{title}</h4>
      <table className="mt-table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td className="num">
                <span className="mt-share small-bar" aria-hidden>
                  <span style={{ width: `${(r.votes / total) * 100}%`, background: "var(--accent)" }} />
                </span>
                {pct((r.votes / total) * 100)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Demographics({ detail }: { detail: EarlyStateDetail }) {
  const groups = [
    { title: "Age", rows: detail.demographics.age },
    { title: "Gender", rows: detail.demographics.gender },
    { title: "Race", rows: detail.demographics.race },
  ].filter((g): g is { title: string; rows: Breakdown } => !!g.rows);
  if (!groups.length) return null;
  return (
    <section className="mt-ev-block" aria-labelledby="ev-demo">
      <h3 id="ev-demo">Who has voted</h3>
      <div className="mt-ev-demos">
        {groups.map((g) => (
          <BreakdownBars key={g.title} {...g} />
        ))}
      </div>
      <p className="muted small">From the state&apos;s voter file, for the ballots it reports these for.</p>
    </section>
  );
}

function CountyRows({ counties, byTown, party }: { counties: EarlyCounty[]; byTown: boolean; party: boolean }) {
  const share = counties.some((c) => c.base2024);
  return (
    <section aria-labelledby="ev-counties">
      <h3 id="ev-counties">{byTown ? "By town" : "By county"}</h3>
      <div className="mt-rows-wrap">
        <table className="mt-table mt-ev-rows">
          <thead>
            <tr>
              <th>{byTown ? "Town" : "County"}</th>
              <th className="num">Ballots</th>
              {share && <th className="num">Of 2024</th>}
              {party && <th className="num">Reg. lead</th>}
            </tr>
          </thead>
          <tbody>
            {counties.map((c) => {
              const s = shareOf2024(c.cast, c.base2024);
              return (
                <tr key={c.fips ?? c.name}>
                  <td>{c.name}</td>
                  <td className="num">{fmt(c.cast)}</td>
                  {share && <td className="num">{s === null ? "—" : pct(s)}</td>}
                  {party && <td className="num">{c.party ? partyLead(c.party) : "—"}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** One state's panel: who's ahead, its counts, 2024 comparison, demographics and places. */
export function StatePanel({ detail }: { detail: EarlyStateDetail }) {
  return (
    <div className="mt-ev-state">
      <LeadCard detail={detail} />
      <Stats counts={detail} base2024={detail.base2024} />
      <VersusPrior detail={detail} />
      <Demographics detail={detail} />
      {detail.counties.length > 0 && <CountyRows counties={detail.counties} byTown={detail.byTown} party={!!detail.party} />}
    </div>
  );
}
