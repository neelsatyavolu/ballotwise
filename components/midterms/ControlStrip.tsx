"use client";

import { useSyncExternalStore } from "react";
import { holderOf, outcomeOf } from "@/lib/midterms/holders";
import type { Coverage } from "@/lib/midterms/coverage";
import { CONTROL_NEED } from "@/lib/midterms/moments";
import { leading, partyOf, type Overview, type RaceSummary, type Tally } from "@/lib/midterms/view";
import { CheckedAgo } from "./CheckedAgo";

type Chamber = "senate" | "house" | "governor";
type Seats = { D: number; R: number; other: number };

const TITLE: Record<Chamber, string> = { senate: "Senate", house: "House", governor: "Governors" };
const NEED: Record<Chamber, { D: number; R: number } | null> = { ...CONTROL_NEED, governor: null };
const NOTE: Record<Chamber, string> = {
  senate: "Not up: the 65 seats not on the ballot. Angus King and Bernie Sanders, independents who caucus with Democrats, count as D.",
  house: "All 435 seats are on the ballot.",
  governor: "Not up: the 14 governors not on the ballot. Governors aren't a chamber, so there's no majority.",
};

const openSeats = (t: Tally) => t.total - t.D - t.R - t.other;
const side = (p: "D" | "R" | "other") => (p === "other" ? "I" : p);

function numbers(office: Chamber, tally: Tally, races: readonly RaceSummary[]) {
  const won: Seats = { D: 0, R: 0, other: 0 };
  const gained: Seats = { D: 0, R: 0, other: 0 };
  const lost: Seats = { D: 0, R: 0, other: 0 };
  let unknownHolder = 0;
  for (const r of races) {
    if (r.office !== office) continue;
    const w = r.candidates.find((c) => c.winner);
    if (!w) continue;
    won[partyOf(w.party)] += 1;
    const o = outcomeOf(r);
    const holder = holderOf(r);
    if (!o || !holder) unknownHolder += 1;
    else if (o.gain) {
      gained[o.side === "I" ? "other" : o.side] += 1;
      lost[holder === "I" ? "other" : holder] += 1;
    }
  }
  const notUp: Seats = { D: tally.D - won.D, R: tally.R - won.R, other: tally.other - won.other };
  // Leads under 25% reporting are counted apart, so a 40-vote lead at 7pm doesn't read like one with most votes in.
  const { early, ...ahead } = leading(races, office);
  return { won, notUp, gained, lost, unknownHolder, ahead, early, uncalled: tally.uncalled };
}

/** "ahead in 6 (+3 barely counted)": early leads (under 25% reporting) are shown apart. Empty when there are none. */
function leadText(leads: number, early: number) {
  if (!leads && !early) return "";
  const barely = early ? `${early} barely counted` : "";
  if (!leads) return `ahead in ${barely}`;
  return `ahead in ${leads}${barely ? ` (+${barely})` : ""}`;
}

/**
 * "D needs 7 more · ahead in 6 (+3 barely counted)", or "D has control" once they have it. `open` is every seat
 * nobody holds yet, including any civicAPI hasn't listed, so a missing race can't fake an elimination.
 */
function needLine(p: "D" | "R", have: number, need: number, leads: number, open: number, early = 0) {
  if (have >= need) return `${p} has control`;
  if (have + open < need) return `${p} can't reach ${need}`;
  const lead = leadText(leads, early);
  return `${p} needs ${need - have} more${lead ? ` · ${lead}` : ""}`;
}

/** "D gains 4 seats": only the side(s) up on flips, since the other side's loss is the same seats. Gains and losses in full sit in the breakdown. */
function netLine(n: ReturnType<typeof numbers>, called: number) {
  const parts = (["D", "R", "other"] as const).filter((p) => n.gained[p] || n.lost[p]);
  if (!called) return null;
  if (!parts.length) return n.unknownHolder ? `No known seat has changed party (${n.unknownHolder} with no record)` : "No seat has changed party";
  const up = parts.map((p) => ({ p, net: n.gained[p] - n.lost[p] })).filter((x) => x.net > 0);
  if (!up.length) return "Flips cancel out";
  const seats = (k: number) => `${k} seat${k === 1 ? "" : "s"}`;
  return up.map(({ p, net }) => `${side(p)} gains ${up.length === 1 ? seats(net) : net}`).join(" · ");
}

function ChamberCard({ office, tally, races, coverage, onNeed }: { office: Chamber; tally: Tally; races: readonly RaceSummary[]; coverage?: Coverage[Chamber]; onNeed?: (office: Chamber) => void }) {
  const n = numbers(office, tally, races);
  const need = NEED[office];
  const share = (x: number) => `${(x / tally.total) * 100}%`;
  const called = n.won.D + n.won.R + n.won.other;
  const sub = (p: keyof Seats) => [n.notUp[p] && `${n.notUp[p]} not up`, `${n.won[p]} won`].filter(Boolean).join(" · ");
  const net = netLine(n, called);
  return (
    <section className="mt-cs-card" aria-label={`${TITLE[office]}: Democrats ${tally.D} seats and leading in ${n.ahead.D}, Republicans ${tally.R} seats and leading in ${n.ahead.R}, ${n.uncalled} uncalled`}>
      <div className="mt-cs-head">
        <h2 title={NOTE[office]}>{TITLE[office]}</h2>
        <span className="small">
          {n.uncalled} of {n.uncalled + called} uncalled
          {coverage && coverage.expected !== null && coverage.listed < coverage.expected && <span className="mt-cs-gap" title="civicAPI doesn't list every race yet; the rest count as open seats"> · {coverage.listed} of {coverage.expected} listed</span>}
          {coverage && coverage.missing > 0 && <span className="mt-cs-gap" title="civicAPI left these out of its latest answer; they show the last numbers it gave"> · {coverage.missing} not updated</span>}
        </span>
      </div>
      <div className="mt-cs-nums">
        <span className="d"><b>{tally.D}</b> D</span>
        {tally.other > 0 && <span className="o"><b>{tally.other}</b> Ind</span>}
        <span className="r">R <b>{tally.R}</b></span>
      </div>
      <div className="mt-cs-bar" aria-hidden>
        <span style={{ width: share(n.notUp.D), background: "var(--dem-held)" }} />
        <span style={{ width: share(n.won.D), background: "var(--dem)" }} />
        <span style={{ width: share(n.ahead.D), background: "var(--dem-lead)" }} />
        <span style={{ width: share(tally.other + n.ahead.other), background: "var(--oth)" }} />
        <span style={{ flex: 1 }} />
        <span style={{ width: share(n.ahead.R), background: "var(--rep-lead)" }} />
        <span style={{ width: share(n.won.R), background: "var(--rep)" }} />
        <span style={{ width: share(n.notUp.R), background: "var(--rep-held)" }} />
        {need && <i className="d" style={{ left: share(need.D) }} title={`${need.D} for Democratic control`} />}
        {need && need.R !== need.D && <i className="r" style={{ left: `calc(100% - ${share(need.R)})` }} title={`${need.R} for Republican control`} />}
      </div>
      <div className="mt-cs-need small">
        {(["D", "R"] as const).map((p) => {
          const text = need ? needLine(p, tally[p], need[p], n.ahead[p], openSeats(tally), n.early[p]) : n.ahead[p] ? `${p} ${leadText(n.ahead[p], n.early[p])}` : "";
          // The need line opens the race list on this chamber's uncalled races, closest calls first: the path to control.
          return onNeed && text && n.uncalled > 0 ? (
            <button key={p} type="button" className="mt-cs-path" onClick={() => onNeed(office)} title={`Show the ${n.uncalled} uncalled ${TITLE[office]} races`}>
              {text} →
            </button>
          ) : (
            <span key={p}>{text}</span>
          );
        })}
      </div>
      <details className="mt-cs-more small">
        <summary>{net ?? "Breakdown"}</summary>
        <div className="mt-cs-sub">
          <span>{sub("D")}</span>
          <span>{sub("R")}</span>
        </div>
        <p className="muted">
          Bar: darker is not up this year, solid is won tonight, pale is leading but not called (leads under 25% reporting are left out as early).{" "}
          {called > 0 && `Gained: ${(["D", "R", "other"] as const).map((p) => `${side(p)} ${n.gained[p]}`).join(", ")}. Lost: ${(["D", "R", "other"] as const).map((p) => `${side(p)} ${n.lost[p]}`).join(", ")}. `}
          {NOTE[office]}
        </p>
      </details>
    </section>
  );
}

/** "D needs 7", "D has control" or "D can't reach 51": the phone bar's short form. */
function shortNeed(p: "D" | "R", have: number, need: number, open: number) {
  if (have >= need) return `${p} has control`;
  if (have + open < need) return `${p} out`;
  return `${p} needs ${need - have}`;
}

/** A phone-sized, always-pinned summary: one short line per chamber and when results were checked. The full cards sit below it. */
function Mini({ data }: { data: Overview }) {
  const line = (office: "senate" | "house", tally: Tally) => {
    const need = NEED[office]!;
    return (
      <span>
        <b>{TITLE[office]}</b> <span className="d">{tally.D}</span>–<span className="r">{tally.R}</span>
        <span className="muted"> · {shortNeed("D", tally.D, need.D, openSeats(tally))} · {shortNeed("R", tally.R, need.R, openSeats(tally))}</span>
      </span>
    );
  };
  return (
    <div className="mt-cs-mini" role="group" aria-label="Control of Congress">
      {line("senate", data.balance.senate)}
      {line("house", data.balance.house)}
      <span className="muted mt-cs-mini-age">
        Checked <CheckedAgo at={data.fetchedAt} />
      </span>
    </div>
  );
}

/** Who is winning each chamber: seats not up, won tonight and leading, against the line for control, with the next poll closing. */
export function ControlStrip({ data, children, onNeed }: { data: Overview; children?: React.ReactNode; onNeed?: (office: Chamber) => void }) {
  const phone = usePhone();
  const cards = (
    <div className="mt-cs" data-panel="control">
      <ChamberCard office="senate" tally={data.balance.senate} races={data.races} coverage={data.coverage?.senate} onNeed={onNeed} />
      <ChamberCard office="house" tally={data.balance.house} races={data.races} coverage={data.coverage?.house} onNeed={onNeed} />
      <ChamberCard office="governor" tally={data.balance.governor} races={data.races} coverage={data.coverage?.governor} onNeed={onNeed} />
      {children}
    </div>
  );
  if (!phone) return cards;
  // On a phone the pinned two-line scoreboard is the summary; the full cards wait behind one tap.
  return (
    <>
      <Mini data={data} />
      <details className="mt-cs-details">
        <summary>Control details</summary>
        {cards}
      </details>
    </>
  );
}

const PHONE = "(max-width: 720px)";
const subscribePhone = (onChange: () => void) => {
  const mq = window.matchMedia(PHONE);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};

function usePhone() {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE).matches, () => false);
}
