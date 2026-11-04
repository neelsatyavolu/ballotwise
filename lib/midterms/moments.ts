// The election-night moments worth interrupting a viewer for, from the overview: a toss-up or lean seat called for
// the party that doesn't hold it. Every other call stays in the feed.
import { holderOf } from "./holders";
import { partyOf, partyTag, raceLabel, type CallEvent, type Overview, type RaceSummary } from "./view";

type Side = "D" | "R" | "I";

/** Seats each side needs for control. The vice president breaks Senate ties for Republicans. Governors aren't a chamber. */
export const CONTROL_NEED = { senate: { D: 51, R: 50 }, house: { D: 218, R: 218 } } as const;

const PARTY = { D: "Democrats", R: "Republicans" } as const;

/** Who controls each chamber going in: Republicans hold both. */
const HELD: Record<keyof typeof CONTROL_NEED, "D" | "R"> = { senate: "R", house: "R" };
const CHAMBER_NAME = { senate: "Senate", house: "House" } as const;

/**
 * The party that has won control of a chamber, from seats won (called races plus those not up): "Democrats take the
 * House", "Republicans keep the Senate"; before that, Decision Desk HQ's call of the chamber (`desk`), marked `by`.
 * Null until one of those, and always for governors.
 */
export function chamberCall(office: string, tally: { D: number; R: number }, desk?: { side: string; at: number } | null): { side: "D" | "R"; text: string; by?: "ddhq"; at?: number } | null {
  if (office !== "senate" && office !== "house") return null;
  const need = CONTROL_NEED[office];
  const won = tally.D >= need.D ? "D" : tally.R >= need.R ? "R" : null;
  // Decision Desk HQ projects control before the seats are all called (see lib/ddhq/pulse.ts callOf).
  const side = won ?? (desk?.side === "D" || desk?.side === "R" ? desk.side : null);
  if (!side) return null;
  const text = `${PARTY[side]} ${HELD[office] === side ? "keep" : "take"} the ${CHAMBER_NAME[office]}`;
  return won ? { side, text } : { side, text, by: "ddhq", at: desk!.at };
}

export type Moment = {
  /** Stable across polls, so the same moment never pops twice. */
  key: string;
  kicker: string;
  title: string;
  body: string;
  /** The race page to open. */
  href: string;
  side: Side | null;
  at: number;
};

/** A race the forecast rated a toss-up or a lean. */
const contested = (r: RaceSummary) => r.rating === "tossup" || !!r.rating?.startsWith("lean");

/**
 * What a pop-up or alert is remembered by: the race, the kind of event and the winner, so the same call shows once
 * whichever source it comes through (our call log, or a connected screen's DDHQ feed, which a race can switch between).
 */
export const momentKey = (e: Pick<CallEvent, "raceId" | "kind"> & Partial<CallEvent>) => `call:${e.raceId}:${e.kind}:${e.winner ?? ""}`;

/** A call event's moment key, the same whatever kind of moment it turns out to be. */
export const callKey = (e: Pick<CallEvent, "id"> & Partial<CallEvent>) => e.source === "ddhq"
  ? `call:ddhq:${e.raceId}:${e.at}:${e.kind}:${e.winner ?? ""}`
  : `call:${e.id}`;

const label = (r: RaceSummary) => (r.office === "measure" ? `${r.state} ${raceLabel(r)}` : raceLabel(r));

function who(name: string, party: string | null) {
  const tag = party ? partyTag(party) : "";
  return tag ? `${name} (${tag})` : name;
}

function sideOf(party: string | null): Side | null {
  if (!party) return null;
  const p = partyOf(party);
  return p === "other" ? "I" : p;
}

/** A call taking a toss-up or lean seat from the party holding it, as a moment; null for any other event. */
function fromEvent(e: CallEvent, r: RaceSummary): Moment | null {
  if (e.kind !== "call" || !e.winner || !contested(r)) return null;
  const side = sideOf(e.party);
  const holder = holderOf(r);
  if (!side || !holder || side === holder) return null;
  return {
    key: momentKey(e),
    title: label(r),
    href: `/midterms/${r.id}`,
    at: e.at,
    kicker: `${side} gain`,
    body: `${who(e.winner, e.party)} wins, taking the seat from ${holder === "I" ? "an independent" : PARTY[holder]}.`,
    side,
  };
}

/** Every moment in the overview now, newest first. */
export function moments(data: Pick<Overview, "races" | "callEvents">): Moment[] {
  const byId = new Map(data.races.map((r) => [r.id, r]));
  const flips = (data.callEvents ?? []).flatMap((e) => {
    const r = byId.get(e.raceId);
    const m = r && fromEvent(e, r);
    return m ? [m] : [];
  });
  return flips.sort((a, b) => b.at - a.at);
}
