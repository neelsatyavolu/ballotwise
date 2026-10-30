"use client";

import { closeWaves, countdown, ELECTION_DAY_START, filedAt, formatET, nextWave, type CloseWave } from "@/lib/midterms/polls";
import { OFFICE_LABEL, raceLabel, STATE_NAMES, type Office, type RaceSummary } from "@/lib/midterms/view";
import { useClock } from "./hooks";

const WAVES = closeWaves();
const DAY = 86_400_000;
/** 6 a.m. Eastern on Nov 3, when the first polls open. */
const POLLS_OPEN = ELECTION_DAY_START + 6 * 3_600_000;

const dayOf = (ms: number) => (ms < ELECTION_DAY_START + DAY ? "Nov 3" : "Nov 4");

const listed = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** Where polls close at one time, in words: "Most of Indiana and Kentucky", or "Florida, Michigan and the rest of Kansas". */
function closingPlaces(states: CloseWave["states"]) {
  const names = (part: CloseWave["states"][number]["part"]) => states.filter((s) => s.part === part).map((s) => STATE_NAMES[s.state] ?? s.state);
  const most = names("most");
  const rest = names("rest");
  const text = listed([...names("all"), ...(most.length ? [`most of ${listed(most)}`] : []), ...(rest.length ? [`the rest of ${listed(rest)}`] : [])]);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A race's name for lists that mix states: measures get their state in front, since many share names like "Amendment 1". */
export function shortLabel(r: RaceSummary) {
  return r.office === "measure" ? `${r.state} ${raceLabel(r)}` : raceLabel(r);
}

/** Races filed under a closing time: those in states whose first polls close then (see filedAt). */
function racesAt(races: readonly RaceSummary[], at: number) {
  return filedAt(races, at).map((f) => f.race);
}

/** How many of the races filed under a closing time are in states where only some polls close then. */
const partialAt = (races: readonly RaceSummary[], at: number) => filedAt(races, at).filter((f) => f.partial).length;

function officeCounts(races: readonly RaceSummary[]) {
  const by: Partial<Record<Office, number>> = {};
  for (const r of races) by[r.office] = (by[r.office] ?? 0) + 1;
  return (["senate", "governor", "house", "measure"] as const)
    .filter((o) => by[o])
    .map((o) => `${by[o]} ${o === "measure" ? "measures" : o === "house" ? "House" : OFFICE_LABEL[o]}`)
    .join(" · ");
}

/** The next poll closing, counting down to the second, with what it opens up. */
export function NextClose({ races, onPick }: { races: readonly RaceSummary[]; onPick: (at: number) => void }) {
  const now = useClock();
  const next = nextWave(now);
  if (!next) {
    return (
      <section className="mt-cs-card mt-cs-next" aria-label="Poll closings">
        <div className="mt-cs-head"><h2>Polls</h2></div>
        <b className="mt-cs-clock done">All closed</b>
        <p className="mt-cs-foot small">The last polls closed at {formatET(WAVES.at(-1)!.at)}. Counting goes on for days in some states.</p>
      </section>
    );
  }
  const closing = racesAt(races, next.at);
  return (
    <section className="mt-cs-card mt-cs-next" aria-label="Next poll closing">
      <div className="mt-cs-head">
        <h2>{now < POLLS_OPEN ? "First polls close" : "Next polls close"}</h2>
        <span className="small"><strong>{formatET(next.at)}</strong> · {dayOf(next.at)}</span>
      </div>
      <b className="mt-cs-clock" role="timer" aria-live="off">{countdown(next.at - now)}</b>
      <p className="mt-cs-foot small">
        <span className="mt-cs-places" title={closingPlaces(next.states)}>{closingPlaces(next.states)}</span>
        {closing.length > 0 && <button type="button" className="mt-linkish" onClick={() => onPick(next.at)}>{officeCounts(closing)} →</button>}
      </p>
    </section>
  );
}

/** Every closing time of the night as one line each; a line's count filters the races to the states closing then. */
export function PollSchedule({ races, picked, onPick }: { races: readonly RaceSummary[]; picked: readonly number[]; onPick: (at: number) => void }) {
  const now = useClock(15_000);
  const next = nextWave(now);
  return (
    <section className="mt-el-sched" aria-label="Poll closing schedule">
      <div className="mt-section-head tight">
        <h2>Poll closings</h2>
        <span className="muted small">Eastern · * part of a state</span>
      </div>
      <ol>
        {WAVES.map((w) => {
          const closed = w.at <= now;
          const isNext = w.at === next?.at;
          const filed = racesAt(races, w.at);
          const partial = partialAt(races, w.at);
          const on = picked.includes(w.at);
          return (
            <li key={w.at} className={`${closed ? "closed" : ""}${isNext ? " next" : ""}`}>
              <details open={isNext}>
                <summary>
                  <b>{formatET(w.at).replace(" ET", "")}</b>
                  <span className="mt-el-sched-states">{w.states.map((s) => (s.part === "all" ? s.state : `${s.state}*`)).join(" ")}</span>
                  <span className="mt-el-sched-status">{closed ? "Closed" : isNext ? countdown(w.at - now) : dayOf(w.at)}</span>
                </summary>
                <p className="small">{closingPlaces(w.states)}.</p>
              </details>
              {filed.length > 0 ? (
                <button type="button" className={`mt-chip${on ? " on" : ""}`} aria-pressed={on} aria-label={`${on ? "Stop showing" : "Show"} the ${filed.length} races filed under ${formatET(w.at)}${partial ? `, ${partial} in states where only some polls close then` : ""}`} onClick={() => onPick(w.at)}>
                  {filed.length}
                  {partial > 0 && "*"}
                </button>
              ) : (
                <span className="mt-chip ghost" title="No races are filed here: these are the rest of states whose first polls closed earlier">0</span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="muted small">Races are grouped by the state&apos;s first poll closing, when its results start. * marks states where the rest of the polls close later, so their races can&apos;t be called until then. Times from <a href="https://www.270towin.com/content/local-poll-closing-times-november-2026-general-election/">270toWin</a>.</p>
    </section>
  );
}
