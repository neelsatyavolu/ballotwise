"use client";

import Link from "next/link";
import { useState } from "react";
import type { RaceInsights as Insights } from "@/app/api/midterms/race/[id]/forecast/route";
import type { Forecast } from "@/lib/midterms/forecast";
import type { PollRow, RacePolls } from "@/lib/midterms/pollAverage";
import type { DdhqRace } from "@/lib/ddhq/votes";
import type { RaceSummary } from "@/lib/midterms/races";
import { marginLabel, nomineeOf } from "@/lib/midterms/view";
import { useLive } from "./hooks";
import { LineChart } from "./LineChart";
import { RatingTag } from "./RaceCard";

/** Brighter party hues for 2px lines on the dark card, as on the market chart. */
const LINE = { D: "var(--dem-ink)", R: "var(--rep-ink)", I: "var(--oth)" } as const;
const day = (t: number) => new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const surname = (name: string) => name.replace(/["“][^"”]*["”]/g, " ").replace(/\b(Jr|Sr|II|III|IV)\.?$/i, "").trim().split(/\s+/).at(-1) ?? name;
const POLL_ROWS = 5;

/** "Cooper +4.2": a left-minus-Republican margin in the nominees' names. */
function lead(margin: number, names: { left: string; right: string }): string {
  if (Math.abs(margin) < 0.05) return "Even";
  return `${surname(margin > 0 ? names.left : names.right)} +${Math.abs(margin).toFixed(1)}`;
}

/** The forecast favorite's full name and chance. */
function favorite(f: Forecast, race: Pick<RaceSummary, "candidates">): { name: string; p: number } | null {
  const [top, second] = Object.entries(f.odds).sort((a, b) => b[1] - a[1]);
  if (!top || top[1] === second?.[1]) return null;
  const side = top[0];
  const name = f.names ? (side === "R" ? f.names.right : f.names.left) : (nomineeOf(race.candidates, side as "D" | "R" | "I")?.name ?? side);
  return { name, p: top[1] };
}

const share = (p: number) => (p >= 0.995 ? ">99%" : p <= 0.005 ? "<1%" : `${(p * 100).toFixed(1)}%`);

/** The forecast for one race: who's favored and by how much, its daily history, and what went into it. */
function ForecastCard({ race, forecast, history }: { race: RaceSummary; forecast: Forecast; history: Insights["history"] }) {
  const fav = favorite(forecast, race);
  const names = forecast.names;
  const points = history ? history.days.flatMap((d, i) => (history.p[i] === null ? [] : [[Date.parse(`${d}T12:00:00Z`) / 1000, history.p[i]!] as const])) : [];
  const leftName = names?.left ?? fav?.name ?? "";
  const lines =
    history && names
      ? [
          { name: surname(names.left), color: LINE[history.side], points },
          { name: surname(names.right), color: LINE.R, points: points.map(([t, p]) => [t, 1 - p] as const) },
        ]
      : [];
  return (
    <div className="mt-mk-card">
      <div className="mt-mk-top">
        <p className="mt-mk-q">{race.total > 0 ? "Pre-election forecast" : "Forecasted win probability"}</p>
        <RatingTag rating={race.rating} signal={race.signal} />
      </div>
      {fav ? <p className="mt-mk-lead">{fav.name} {Math.round(fav.p * 100)}%</p> : <p className="mt-mk-lead">Even</p>}
      {lines.length > 0 && points.length >= 2 ? (
        <LineChart lines={lines} ticks={[0, 0.5, 1]} value={(p) => `${Math.round(p * 100)}%`} date={day} label={`Forecast history for ${leftName}`} empty="" />
      ) : (
        names && (
          <div className="mt-fc-split" role="img" aria-label={`${names.left} ${share(forecast.odds[forecast.left] ?? 0)}, ${names.right} ${share(forecast.odds.R ?? 0)}`}>
            <span style={{ width: `${(forecast.odds[forecast.left] ?? 0) * 100}%`, background: LINE[forecast.left] }} />
            <span style={{ width: `${(forecast.odds.R ?? 0) * 100}%`, background: LINE.R }} />
          </div>
        )
      )}
      {names && (
        <details className="mt-fc-more">
        <summary>How we got this</summary>
        <dl className="mt-fc-parts">
          {forecast.lean !== null && (
            <div>
              <dt>2024 president here</dt>
              <dd>{marginLabel(forecast.lean)}</dd>
            </div>
          )}
          {forecast.environment !== null && forecast.environment !== 0 && (
            <div>
              <dt>National environment</dt>
              <dd>{marginLabel(forecast.environment)}</dd>
            </div>
          )}
          {forecast.incumbency !== 0 && (
            <div>
              <dt>Incumbent running</dt>
              <dd>{lead(forecast.incumbency, names)}</dd>
            </div>
          )}
          {forecast.personal !== undefined && forecast.personal !== null && Math.abs(forecast.personal) >= 0.05 && (
            <div>
              <dt>Incumbent&apos;s own vote</dt>
              <dd>{lead(forecast.personal, names)}</dd>
            </div>
          )}
          {forecast.fundraising !== undefined && forecast.fundraising !== null && Math.abs(forecast.fundraising) >= 0.05 && (
            <div>
              <dt>Fundraising gap</dt>
              <dd>{lead(forecast.fundraising, names)}</dd>
            </div>
          )}
          {forecast.fundamentals !== null && (
            <div>
              <dt>Fundamentals</dt>
              <dd>{lead(forecast.fundamentals, names)}</dd>
            </div>
          )}
          {forecast.pollMargin !== null && (
            <div>
              <dt>Polls · {Math.round(forecast.pollWeight * 100)}% of the margin</dt>
              <dd>{lead(forecast.pollMargin, names)}</dd>
            </div>
          )}
          {forecast.market !== null && (
            <div>
              <dt>Markets · {Math.round(forecast.marketWeight * 100)}% of the chance</dt>
              <dd>
                {surname(forecast.market >= 0.5 ? names.left : names.right)} {Math.round(Math.max(forecast.market, 1 - forecast.market) * 100)}%
              </dd>
            </div>
          )}
          {forecast.expert !== undefined && forecast.expert !== null && (forecast.expertWeight ?? 0) > 0 && (
            <div>
              <dt>Expert ratings · {Math.round((forecast.expertWeight ?? 0) * 100)}% of the chance</dt>
              <dd>
                {Math.abs(forecast.expert - 0.5) < 0.005 ? "Even" : `${surname(forecast.expert >= 0.5 ? names.left : names.right)} ${Math.round(Math.max(forecast.expert, 1 - forecast.expert) * 100)}%`}
              </dd>
            </div>
          )}
        </dl>
        <Link className="mt-mk-src small" href="/midterms/methodology">
          How the forecast works →
        </Link>
        </details>
      )}
    </div>
  );
}

/** "Oct 24–25", "Sep 29–Oct 3", or one date. */
const dates = (r: PollRow) => {
  const f = (s: string, o: Intl.DateTimeFormatOptions) => new Date(`${s}T12:00:00Z`).toLocaleDateString("en-US", { ...o, timeZone: "UTC" });
  if (!r.end) return "—";
  if (!r.start || r.start === r.end) return f(r.end, { month: "short", day: "numeric" });
  const sameMonth = r.start.slice(0, 7) === r.end.slice(0, 7);
  return `${f(r.start, { month: "short", day: "numeric" })}–${f(r.end, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" })}`;
};

/** The race's polling average over time and every poll behind it, newest first. */
function PollsCard({ polls }: { polls: RacePolls }) {
  const [all, setAll] = useState(false);
  const names = { left: polls.leftName, right: polls.rightName };
  const rows = all ? polls.rows : polls.rows.slice(0, POLL_ROWS);
  const lines = [
    { name: surname(polls.leftName), color: LINE[polls.left], points: polls.trend.map((p) => [p[0], p[1]] as const) },
    { name: surname(polls.rightName), color: LINE.R, points: polls.trend.map((p) => [p[0], p[2]] as const) },
  ];
  return (
    <div className="mt-mk-card">
      <p className="mt-mk-q">Polling average</p>
      <p className="mt-mk-lead">{polls.average ? `${lead(polls.average.margin, names)}` : "Not enough polls yet"}</p>
      {polls.average && (
        <>
          <LineChart lines={lines} domain="auto" step={5} value={(v) => `${Math.round(v)}%`} date={day} label={`Polling average: ${lead(polls.average.margin, names)}`} empty="" />
          <ul className="mt-mk-legend">
            {lines.map((l, i) => (
              <li key={l.name}>
                <svg width="16" height="8" aria-hidden>
                  <line x1="0" x2="16" y1="4" y2="4" style={{ stroke: l.color }} strokeWidth="2" />
                </svg>
                {l.name} <span>{(i === 0 ? polls.average!.left : polls.average!.right).toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="mt-pl-scroll">
        <table className="mt-pl-table">
          <thead>
            <tr>
              <th>Pollster</th>
              <th>Dates</th>
              <th className="num">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.pollster}${r.start}${r.end}`} className={r.excluded ? "out" : undefined}>
                <td>
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noreferrer">
                      {r.pollster}
                    </a>
                  ) : (
                    r.pollster
                  )}
                  {(r.internal || r.partisan) && <span className="mt-pl-tag" title={r.internal ? "Campaign internal poll" : `${r.partisan} sponsor`}>{r.internal ? "Int." : r.partisan}</span>}
                </td>
                <td className="mt-pl-d">{dates(r)}</td>
                <td className="num" title={r.excluded ?? undefined}>{r.margin === null ? "—" : lead(r.margin, names)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {polls.rows.length > POLL_ROWS && (
        <button type="button" className="btn quiet small" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${polls.rows.length} polls`}
        </button>
      )}
      <p className="muted small">
        Polls from <a href="https://votehub.com/polls">VoteHub</a> (CC BY 4.0) · <Link href="/midterms/methodology#polls">How the average works</Link>
      </p>
    </div>
  );
}

const LINE_PARTY = { D: "var(--dem-ink)", R: "var(--rep-ink)", I: "var(--oth)" } as const;

/** Decision Desk HQ's forecast for this user. Shown instead of Ballotwise's when their Votes Pro account is connected. */
function DdhqCard({ race }: { race: DdhqRace }) {
  const [top, next] = race.forecast;
  return (
    <div className="mt-mk-card">
      <div className="mt-mk-top">
        <p className="mt-mk-q">Decision Desk HQ forecast</p>
      </div>
      {top ? <p className="mt-mk-lead">{top.name} {Math.round(top.probability * 100)}%</p> : <p className="mt-mk-lead">No forecast yet</p>}
      {top && next && (
        <div className="mt-fc-split" role="img" aria-label={race.forecast.map((row) => `${row.name} ${Math.round(row.probability * 100)}%`).join(", ")}>
          {race.forecast.map((row) => (
            <span key={row.name} style={{ width: `${row.probability * 100}%`, background: LINE_PARTY[row.party] }} />
          ))}
        </div>
      )}
      {race.call && <p className="muted small">Called for {race.call.name}.</p>}
      <p className="muted small">From your Votes Pro account. Other visitors still see Ballotwise&apos;s forecast.</p>
    </div>
  );
}

/** A race's forecast and polls, like DDHQ's race page; each panel is left out when there's nothing to show. */
export function RaceInsights({ race, ddhq }: { race: RaceSummary; ddhq?: DdhqRace | null }) {
  const { data } = useLive<Insights>(`/api/midterms/race/${race.id}/forecast`);
  const forecast = race.signal?.forecast ?? null;
  return (
    <>
      {ddhq && ddhq.forecast.length > 0 ? (
        <section className="mt-mk" aria-label="Forecast">
          <h3 className="mt-mk-head">Forecast</h3>
          <DdhqCard race={ddhq} />
        </section>
      ) : (
        forecast && (
          <section className="mt-mk" aria-label="Forecast">
            <h3 className="mt-mk-head">Forecast</h3>
            <ForecastCard race={race} forecast={forecast} history={data?.history ?? null} />
          </section>
        )
      )}
      {data?.polls && data.polls.rows.length > 0 && (
        <section className="mt-mk" aria-label="Polls">
          <h3 className="mt-mk-head" id="polls">
            Polls
          </h3>
          <PollsCard polls={data.polls} />
        </section>
      )}
    </>
  );
}
