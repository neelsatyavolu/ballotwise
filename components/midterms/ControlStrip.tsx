"use client";

import { useSyncExternalStore } from "react";
import { holderOf, outcomeOf } from "@/lib/midterms/holders";
import type { Coverage } from "@/lib/midterms/coverage";
import { leading, partyOf, type Overview, type RaceSummary, type Tally } from "@/lib/midterms/view";

type Chamber = "senate" | "house" | "governor";
type Seats = { D: number; R: number; other: number };

const TITLE: Record<Chamber, string> = { senate: "Senate", house: "House", governor: "Governors" };
/** Seats each side needs for control. The vice president breaks Senate ties for Republicans. Governors aren't a chamber. */
const NEED: Record<Chamber, { D: number; R: number } | null> = { senate: { D: 51, R: 50 }, house: { D: 218, R: 218 }, governor: null };
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
  return { won, notUp, gained, lost, unknownHolder, ahead: leading(races, office), uncalled: tally.uncalled };
}

/** "D needs 7 more · leads 6", or "D has control" once they have it. */
/** `open` is every seat nobody holds yet, including any civicAPI hasn't listed, so a missing race can't fake an elimination. */
function needLine(p: "D" | "R", have: number, need: number, leads: number, open: number) {
  if (have >= need) return `${p} has control`;
  if (have + open < need) return `${p} can't reach ${need}`;
  return `${p} needs ${need - have} more${leads ? ` · leads ${leads}` : ""}`;
}

/** "Net D +1 (D gained 2, lost 1)", or a plain statement when nothing has changed hands. */
function netLine(n: ReturnType<typeof numbers>, called: number) {
  const parts = (["D", "R", "other"] as const).filter((p) => n.gained[p] || n.lost[p]);
  if (!called) return null;
  if (!parts.length) return n.unknownHolder ? `No known seat has changed party (${n.unknownHolder} with no record)` : "No seat has changed party";
  return parts.map((p) => `${side(p)} ${n.gained[p] - n.lost[p] >= 0 ? "+" : ""}${n.gained[p] - n.lost[p]} net`).join(" · ");
}

function ChamberCard({ office, tally, races, coverage }: { office: Chamber; tally: Tally; races: readonly RaceSummary[]; coverage?: Coverage[Chamber] }) {
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
        <span>{need ? needLine("D", tally.D, need.D, n.ahead.D, openSeats(tally)) : n.ahead.D ? `D leads ${n.ahead.D}` : ""}</span>
        <span>{need ? needLine("R", tally.R, need.R, n.ahead.R, openSeats(tally)) : n.ahead.R ? `R leads ${n.ahead.R}` : ""}</span>
      </div>
      <details className="mt-cs-more small">
        <summary>{net ?? "Breakdown"}</summary>
        <div className="mt-cs-sub">
          <span>{sub("D")}</span>
          <span>{sub("R")}</span>
        </div>
        <p className="muted">
          Bar: darker is not up this year, solid is won tonight, pale is leading but not called.{" "}
          {called > 0 && `Gained: ${(["D", "R", "other"] as const).map((p) => `${side(p)} ${n.gained[p]}`).join(", ")}. Lost: ${(["D", "R", "other"] as const).map((p) => `${side(p)} ${n.lost[p]}`).join(", ")}. `}
          {NOTE[office]}
        </p>
      </details>
    </section>
  );
}

/** A phone-sized, always-pinned summary: one line per chamber. The full cards sit below it and scroll away. */
function Mini({ data }: { data: Overview }) {
  const line = (office: "senate" | "house", tally: Tally) => {
    const need = NEED[office]!;
    const ahead = leading(data.races, office);
    return (
      <span>
        <b>{TITLE[office]}</b> <span className="d">{tally.D}</span>–<span className="r">{tally.R}</span>
        <span className="muted"> · {needLine("D", tally.D, need.D, ahead.D, openSeats(tally))} · {needLine("R", tally.R, need.R, ahead.R, openSeats(tally))}</span>
      </span>
    );
  };
  return (
    <div className="mt-cs-mini" role="group" aria-label="Control of Congress">
      {line("senate", data.balance.senate)}
      {line("house", data.balance.house)}
    </div>
  );
}

/** Who is winning each chamber: seats not up, won tonight and leading, against the line for control, with the next poll closing. */
export function ControlStrip({ data, children }: { data: Overview; children?: React.ReactNode }) {
  const phone = usePhone();
  const cards = (
    <div className="mt-cs">
      <ChamberCard office="senate" tally={data.balance.senate} races={data.races} coverage={data.coverage?.senate} />
      <ChamberCard office="house" tally={data.balance.house} races={data.races} coverage={data.coverage?.house} />
      <ChamberCard office="governor" tally={data.balance.governor} races={data.races} coverage={data.coverage?.governor} />
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
