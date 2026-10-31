// The election-night moments worth interrupting a viewer for, from the overview: a chamber decided, a call changed or
// withdrawn, a seat changing party, a call in a starred race, a toss-up called. Routine calls stay in the feed.
import { holderOf } from "./holders";
import { partyOf, partyTag, raceLabel, type CallEvent, type Overview, type RaceSummary } from "./view";

type Side = "D" | "R" | "I";

/** Seats each side needs for control. The vice president breaks Senate ties for Republicans. Governors aren't a chamber. */
export const CONTROL_NEED = { senate: { D: 51, R: 50 }, house: { D: 218, R: 218 } } as const;

const CHAMBER = { senate: "Senate", house: "House" } as const;
const PARTY = { D: "Democrats", R: "Republicans" } as const;

/** Most important first: lower ranks lead the pop-up when several arrive together. */
export const RANK = { control: 0, correction: 1, flip: 2, starred: 3, tossup: 4 } as const;

export type Moment = {
  /** Stable across polls, so the same moment never pops twice. */
  key: string;
  rank: number;
  kicker: string;
  title: string;
  body: string;
  /** The race page to open, or null for a chamber. */
  href: string | null;
  side: Side | null;
  at: number;
};

/** A call event's moment key, the same whatever kind of moment it turns out to be. */
export const callKey = (e: Pick<CallEvent, "id">) => `call:${e.id}`;

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

function fromEvent(e: CallEvent, r: RaceSummary, starred: ReadonlySet<number>): Moment | null {
  const base = { key: callKey(e), title: label(r), href: `/midterms/${r.id}`, at: e.at };
  if (e.kind === "withdrawal") {
    return { ...base, rank: RANK.correction, kicker: "Call withdrawn", body: `The call for ${e.previous ?? "the leader"} was withdrawn. The race is uncalled again.`, side: null };
  }
  if (!e.winner) return null;
  const side = sideOf(e.party);
  const winner = who(e.winner, e.party);
  if (e.kind === "change") {
    return { ...base, rank: RANK.correction, kicker: "Call changed", body: `Now called for ${winner}${e.previous ? `, not ${e.previous}` : ""}.`, side };
  }
  const holder = holderOf(r);
  if (side && holder && side !== holder) {
    return { ...base, rank: RANK.flip, kicker: `${side} gain`, body: `${winner} wins, taking the seat from ${holder === "I" ? "an independent" : PARTY[holder]}.`, side };
  }
  if (starred.has(r.id)) return { ...base, rank: RANK.starred, kicker: "Your race is called", body: `${winner} wins.`, side };
  if (r.rating === "tossup") return { ...base, rank: RANK.tossup, kicker: "Toss-up called", body: `${winner} wins${holder && side ? `, a ${side} hold` : ""}.`, side };
  return null;
}

function control(data: Pick<Overview, "balance" | "fetchedAt">): Moment[] {
  const out: Moment[] = [];
  for (const chamber of ["senate", "house"] as const) {
    for (const p of ["D", "R"] as const) {
      const have = data.balance[chamber][p];
      if (have < CONTROL_NEED[chamber][p]) continue;
      out.push({
        key: `control:${chamber}:${p}`,
        rank: RANK.control,
        kicker: `${CHAMBER[chamber]} control`,
        title: `${PARTY[p]} win the ${CHAMBER[chamber]}`,
        body: `${PARTY[p]} have ${have} seats, enough for a majority.`,
        href: null,
        side: p,
        at: data.fetchedAt,
      });
    }
  }
  return out;
}

/** Every moment in the overview now, most important and then newest first. */
export function moments(data: Pick<Overview, "races" | "balance" | "fetchedAt" | "callEvents">, starred: ReadonlySet<number>): Moment[] {
  const byId = new Map(data.races.map((r) => [r.id, r]));
  const calls = (data.callEvents ?? []).flatMap((e) => {
    const r = byId.get(e.raceId);
    const m = r && fromEvent(e, r, starred);
    return m ? [m] : [];
  });
  return [...control(data), ...calls].sort((a, b) => a.rank - b.rank || b.at - a.at);
}
