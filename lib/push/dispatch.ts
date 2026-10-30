// Run by the cron job after results are recorded: sends race-call, chamber-control and poll-closing alerts.
import type { Db } from "../auth/accounts";
import { callEventsAfter } from "../midterms/calls";
import { balance, type RaceSummary } from "../midterms/races";
import { callPushes, controlDecided, dueWave, waveMessage, type Device } from "./alerts";
import { sendAll, type ApnsConfig, type Push, type TokenStore } from "./apns";
import { deleteDevices, listDevices } from "./devices";

/** Call events handled per run; a backlog drains over the following runs. */
const EVENTS_PER_RUN = 100;
/** Pushes sent per run, to stay well inside the Worker's subrequest limit; past it the least urgent are dropped. */
export const MAX_PUSHES_PER_RUN = 900;
/** A chamber must look decided for this long (two cron runs) before control is announced, so one bad flag can't. */
export const CONTROL_CONFIRM_MS = 4 * 60 * 1000;

/**
 * Moves the calls cursor from `from` to `to`, only if no other run moved it first. The cursor is claimed before
 * sending, so a crash mid-send skips those alerts rather than sending them twice.
 */
async function claimCursor(db: Db, from: number | null, to: number): Promise<boolean> {
  const claim =
    from === null
      ? db.prepare("INSERT OR IGNORE INTO push_sent (key, at) VALUES ('calls', ?) RETURNING at").bind(to)
      : db.prepare("UPDATE push_sent SET at = ? WHERE key = 'calls' AND at = ? RETURNING at").bind(to, from);
  return !!(await claim.first<{ at: number }>());
}

/** Records a one-time alert as sent; true only for the run that recorded it. */
async function claimOnce(db: Db, key: string, now: number): Promise<boolean> {
  return !!(await db.prepare("INSERT OR IGNORE INTO push_sent (key, at) VALUES (?, ?) RETURNING key").bind(key, now).first<{ key: string }>());
}

async function callAlerts(db: Db, races: ReadonlyMap<number, RaceSummary>, devices: readonly Device[]): Promise<Push[]> {
  const cursor = (await db.prepare("SELECT at FROM push_sent WHERE key = 'calls'").first<{ at: number }>())?.at ?? null;
  if (cursor === null) {
    // First run: start from now. Calls made before push existed aren't news.
    const latest = (await db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM midterm_call_events").first<{ id: number }>())?.id ?? 0;
    await claimCursor(db, null, latest);
    return [];
  }
  const events = await callEventsAfter(db, cursor, EVENTS_PER_RUN);
  if (events.length === 0 || !(await claimCursor(db, cursor, events[events.length - 1].id))) return [];
  return callPushes(events, races, devices);
}

/**
 * Announces a chamber once a party's called seats reach a majority and still do at least CONTROL_CONFIRM_MS after
 * the first run that saw it. civicAPI has briefly flagged winners by mistake; a decision that doesn't hold is forgotten.
 */
async function controlAlerts(db: Db, races: readonly RaceSummary[], devices: readonly Device[], now: number): Promise<Push[]> {
  const decided = controlDecided(balance(races));
  const keep = decided.map((c) => `seen:${c.key}`);
  await db.prepare(`DELETE FROM push_sent WHERE key LIKE 'seen:control:%' AND key NOT IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(keep)).run();
  const out: Push[] = [];
  for (const { key, message } of decided) {
    await db.prepare("INSERT OR IGNORE INTO push_sent (key, at) VALUES (?, ?)").bind(`seen:${key}`, now).run();
    const seen = await db.prepare("SELECT at FROM push_sent WHERE key = ?").bind(`seen:${key}`).first<{ at: number }>();
    if (!seen || now - seen.at < CONTROL_CONFIRM_MS || !(await claimOnce(db, key, now))) continue;
    out.push(...devices.filter((d) => d.alerts.control).map((d) => ({ ...message, token: d.token, environment: d.environment })));
  }
  return out;
}

async function waveAlerts(db: Db, devices: readonly Device[], now: number): Promise<Push[]> {
  const wave = dueWave(now);
  if (!wave || !(await claimOnce(db, `polls:${wave.at}`, now))) return [];
  return devices.filter((d) => d.alerts.pollClose).map((d) => ({ ...waveMessage(wave, d.homeState), token: d.token, environment: d.environment }));
}

/** Runs one kind of alert; a failure is logged and sends nothing for that kind, but doesn't stop the others. */
async function safely(kind: string, work: () => Promise<Push[]>): Promise<Push[]> {
  try {
    return await work();
  } catch (err) {
    console.error(`push: ${kind} alerts failed:`, err instanceof Error ? err.message : err);
    return [];
  }
}

/** The APNs provider token kept in push_sent, shared by every isolate. */
function tokenStore(db: Db, keyId: string): TokenStore {
  const key = `jwt:${keyId}`;
  return {
    read: async () => {
      const row = await db.prepare("SELECT value, at FROM push_sent WHERE key = ?").bind(key).first<{ value: string | null; at: number }>();
      return row?.value ? { jwt: row.value, at: row.at } : null;
    },
    write: async (jwt, at) => {
      await db.prepare("INSERT INTO push_sent (key, at, value) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET at = excluded.at, value = excluded.value").bind(key, at, jwt).run();
    },
  };
}

/** Sends every alert due now and forgets devices APNs says are gone. `races` is the catalog just recorded. */
export async function dispatchPushes(db: Db, config: ApnsConfig, races: readonly RaceSummary[], now: number): Promise<{ sent: number; failed: number; dropped: number }> {
  const devices = await listDevices(db);
  const byId = new Map(races.map((r) => [r.id, r]));
  // Cursors and one-time keys advance even with no devices, so a new device never gets a backlog.
  // Most urgent first, so a run over the cap drops individual race calls before control or poll closings.
  const all = [
    ...(await safely("control", () => controlAlerts(db, races, devices, now))),
    ...(await safely("poll closing", () => waveAlerts(db, devices, now))),
    ...(await safely("call", () => callAlerts(db, byId, devices))),
  ];
  const pushes = all.slice(0, MAX_PUSHES_PER_RUN);
  const dropped = all.length - pushes.length;
  if (dropped > 0) console.error(`push: over the per-run cap, dropped ${dropped} of ${all.length}`);
  const results = await sendAll(pushes, config, now, { store: tokenStore(db, config.keyId) });
  await deleteDevices(db, [...new Set(results.filter((r) => r.gone).map((r) => r.token))]).catch((err) => console.error("push: couldn't forget dead tokens:", err));
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) console.error(`push: ${failed.length} of ${results.length} failed, e.g. ${failed[0].reason}`);
  return { sent: results.length - failed.length, failed: failed.length, dropped };
}

/** The APNs settings from the Worker's secrets and vars, or null when push isn't set up. */
export function apnsConfig(env: { APNS_KEY?: string; APNS_KEY_ID?: string; APNS_TEAM_ID?: string; APNS_TOPIC?: string }): ApnsConfig | null {
  const { APNS_KEY: key, APNS_KEY_ID: keyId, APNS_TEAM_ID: teamId, APNS_TOPIC: topic } = env;
  return key && keyId && teamId && topic ? { key, keyId, teamId, topic } : null;
}
