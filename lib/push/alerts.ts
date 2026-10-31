// What to tell each device: pure functions from race calls, seat counts and the clock to notifications.
import type { CallEvent } from "../midterms/calls";
import { holderOf, type Side } from "../midterms/holders";
import { closeWaves, formatTime, type CloseWave } from "../midterms/polls";
import type { RaceSummary, Tally } from "../midterms/races";
import { partyOf, partyTag, raceLabel, STATE_NAMES } from "../midterms/view";
import type { Environment, Push } from "./apns";

export type Alerts = { starred: boolean; control: boolean; allCalls: boolean; pollClose: boolean };
export type Device = { token: string; environment: Environment; alerts: Alerts; starred: readonly number[]; homeState: string | null };
type Message = Omit<Push, "token" | "environment">;

/** Past this many call alerts in one run, a device gets one summary instead (starred races still come one by one). */
export const DIGEST_AFTER = 3;
/** A poll-closing alert goes out up to this long after the time, so a late or skipped cron run still sends it. */
export const WAVE_WINDOW_MS = 20 * 60 * 1000;

const PARTY_NAME: Record<Side, string> = { D: "Democrats", R: "Republicans", I: "Independents" };
const sideOf = (party: string | null): Side | null => {
  if (!party) return null;
  const p = partyOf(party);
  return p === "other" ? "I" : p;
};

const named = (name: string, party: string | null) => {
  const tag = party ? partyTag(party) : "";
  return tag ? `${name} (${tag})` : name;
};

/** Whether a call takes a seat from the party holding it now. Withdrawals and measures never flip. */
export function isFlip(event: CallEvent, race: RaceSummary | undefined): boolean {
  if (event.kind === "withdrawal" || event.office === "measure" || !race) return false;
  const holder = holderOf(race);
  const side = sideOf(event.party);
  return !!holder && !!side && side !== holder;
}

/** The notification for one call event. */
export function callMessage(event: CallEvent, race: RaceSummary | undefined): Message {
  const label = race ? raceLabel(race) : "A race";
  const base = { threadId: `race-${event.raceId}`, raceId: event.raceId, collapseId: `call-${event.id}` };
  if (event.kind === "withdrawal") {
    return { ...base, title: `Call withdrawn: ${label}`, body: `The call for ${event.previous} was withdrawn. The race is uncalled again.` };
  }
  if (event.office === "measure") {
    const passed = /^yes$/i.test(event.winner ?? "");
    return { ...base, title: `${passed ? "Passed" : "Failed"}: ${label}`, body: passed ? "Voters approved this measure." : "Voters rejected this measure." };
  }
  const who = named(event.winner ?? "", event.party);
  if (event.kind === "change") {
    return { ...base, title: `Call changed: ${label}`, body: `${who} is now projected to win, replacing ${event.previous}.` };
  }
  if (isFlip(event, race)) {
    const holder = holderOf(race!)!;
    return { ...base, title: `Flip: ${label}`, body: `${who} wins, taking the seat from ${PARTY_NAME[holder]}.` };
  }
  return { ...base, title: `Called: ${label}`, body: `${who} wins.` };
}

/**
 * Whether a changed or withdrawn call undoes an earlier flip: the previous winner was from a party other than the
 * seat's holder. Control devices heard about that flip, so they hear about this too.
 */
export function undoesFlip(event: CallEvent, race: RaceSummary | undefined): boolean {
  if (event.kind === "call" || event.office === "measure" || !race || !event.previous) return false;
  const holder = holderOf(race);
  const previous = sideOf(race.candidates.find((c) => c.name === event.previous)?.party ?? null);
  return !!holder && !!previous && previous !== holder;
}

/** Whether `device` wants to hear about `event`, and whether it's one of its starred races. */
function wants(device: Device, event: CallEvent, race: RaceSummary | undefined): { yes: boolean; starred: boolean } {
  const starred = device.alerts.starred && device.starred.includes(event.raceId);
  const any = device.alerts.allCalls && event.office !== "measure";
  // House flips are too many to count as control news; Senate and governor flips are.
  const flip = device.alerts.control && event.office !== "house" && (isFlip(event, race) || undoesFlip(event, race));
  return { yes: starred || any || flip, starred };
}

/** Each device's notifications for a run's call events, oldest first, with busy runs folded into a summary. */
export function callPushes(events: readonly CallEvent[], races: ReadonlyMap<number, RaceSummary>, devices: readonly Device[]): Push[] {
  return devices.flatMap((device) => {
    const picked = events.map((e) => ({ event: e, ...wants(device, e, races.get(e.raceId)) })).filter((p) => p.yes);
    const starred = picked.filter((p) => p.starred);
    const rest = picked.filter((p) => !p.starred);
    const single = (event: CallEvent): Push => ({ ...callMessage(event, races.get(event.raceId)), token: device.token, environment: device.environment });
    const out = starred.map((p) => single(p.event));
    if (rest.length > DIGEST_AFTER) out.push({ ...digest(rest.map((p) => p.event), races), token: device.token, environment: device.environment });
    else out.push(...rest.map((p) => single(p.event)));
    return out;
  });
}

function digest(events: readonly CallEvent[], races: ReadonlyMap<number, RaceSummary>): Message {
  const lines = events.map((e) => {
    const race = races.get(e.raceId);
    const label = race ? raceLabel(race) : "A race";
    return e.kind === "withdrawal" ? `${label}: call withdrawn` : `${label}: ${e.winner}${e.party && partyTag(e.party) ? ` (${partyTag(e.party)})` : ""}`;
  });
  const shown = lines.slice(0, 6).join("\n");
  const more = lines.length > 6 ? `\nand ${lines.length - 6} more` : "";
  const title = events.every((e) => e.kind === "call") ? `${events.length} races called` : `${events.length} race call updates`;
  return { title, body: shown + more, threadId: "calls", collapseId: `digest-${events[events.length - 1].id}` };
}

export type Control = { key: string; message: Message };

/** Chambers a party has now secured from called races: 51 Senate seats for Democrats, 50 for Republicans (the vice president breaks ties), 218 House seats. */
export function controlDecided(balance: { senate: Tally; house: Tally }): Control[] {
  const out: Control[] = [];
  const add = (chamber: "senate" | "house", side: "D" | "R", seats: number, of: number) =>
    out.push({
      key: `control:${chamber}:${side}`,
      message: {
        title: `${PARTY_NAME[side]} will control the ${chamber === "senate" ? "Senate" : "House"}`,
        body: `Called races give ${PARTY_NAME[side]} ${seats} of ${of} seats.`,
        threadId: "control",
        collapseId: `control-${chamber}`,
      },
    });
  const { senate, house } = balance;
  if (senate.D >= 51) add("senate", "D", senate.D, senate.total);
  if (senate.R >= 50) add("senate", "R", senate.R, senate.total);
  if (house.D >= house.majority) add("house", "D", house.D, house.total);
  if (house.R >= house.majority) add("house", "R", house.R, house.total);
  return out;
}

/** The poll-closing wave whose time has just passed (within WAVE_WINDOW_MS), or null. */
export function dueWave(now: number, waves: readonly CloseWave[] = closeWaves()): CloseWave | null {
  return waves.find((w) => now >= w.at && now - w.at < WAVE_WINDOW_MS) ?? null;
}

/** A wave's notification, naming the device's own state first when its polls are among those closing. */
export function waveMessage(wave: CloseWave, homeState: string | null): Message {
  const list = wave.states.map((s) => (s.part === "all" ? s.state : `${s.state} (${s.part === "most" ? "most" : "rest"})`)).join(", ");
  const time = formatTime(wave.at);
  const home = homeState ? wave.states.find((s) => s.state === homeState) : undefined;
  const base = { threadId: "polls", collapseId: `polls-${wave.at}` };
  if (home) {
    const name = STATE_NAMES[home.state] ?? home.state;
    return { ...base, title: home.part === "most" ? `Most polls are closed in ${name}` : `Polls are closed in ${name}`, body: `${time}: polls closed in ${list}.` };
  }
  return { ...base, title: `Polls closing at ${time}`, body: `Polls just closed in ${list}.` };
}
