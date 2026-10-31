import { z } from "zod";
import { AccountError } from "../auth/accounts";
import { HOLDOVER } from "../midterms/races";
import type { ChamberView, RatingCounts } from "../midterms/forecast";
import type { ChamberPoint } from "../midterms/odds";
import { votesSessionCookie } from "./clerk";
import type { DdhqForecastBundle } from "./forecast-types";
import { publishedRating } from "./rating";
import { readForecast, rememberRaceIds, seatKey, votes, type DdhqRace, type DdhqSeat } from "./votes";
import type { DdhqSession } from "./vault";

type Office = DdhqSeat["office"];
const OFFICES: Office[] = ["house", "senate", "governor"];
const OFFICE_NAME = { house: "US House", senate: "US Senate", governor: "Governor" };
const dateText = (value: string) => value.replace(/^\$D/, "");
const partySchema = z.object({
  partyId: z.number(), shortAbbrev: z.string(),
  winProbability: z.number().min(0).max(1),
  seats: z.number().nonnegative().optional(),
  candidates: z.array(z.object({ name: z.string().optional(), firstName: z.string().optional(), lastName: z.string().optional() })).optional(),
});
const raceSchema = z.object({ raceId: z.number().int().positive(), parties: z.array(partySchema), rating: z.string(), updatedAt: z.string() });
const metaSchema = z.object({
  id: z.coerce.number().int().positive(), stateAbb: z.string().regex(/^[A-Z]{2}$/),
  office: z.string(), officeId: z.coerce.number().int().positive(), district: z.string(), electionType: z.string(), race_date: z.string(),
});
const overviewSchema = z.object({
  toplineId: z.number().int().positive(), officeId: z.number().int().positive(),
  forecast: z.object({ officeId: z.number().int().positive(), stateId: z.null(), year: z.literal(2026), parties: z.array(partySchema), updatedAt: z.string() }),
  timeseries: z.array(z.object({ date: z.string(), parties: z.array(partySchema) })),
  simulations: z.array(z.object({ count: z.number().nonnegative(), parties: z.array(z.object({ partyId: z.number(), seats: z.number().nonnegative() })) })),
});

function unavailable(): never {
  throw new AccountError("Decision Desk HQ's published forecast isn't available right now.", 502);
}

type ParsedPage = {
  races: { key: string; id: string; race: DdhqRace }[];
  chamber?: ChamberView;
  history: ChamberPoint[];
  ratings: RatingCounts;
  updatedAt: number;
};

/**
 * Votes sends its published forecasts as JSON records in a React Server Component response.
 * Read only the forecast records; never evaluate code or return the page's account/bootstrap props.
 */
export function readForecastPage(text: string, office: Office): ParsedPage {
  const forecasts = new Map<number, z.infer<typeof raceSchema>>();
  const metadata = new Map<number, z.infer<typeof metaSchema>>();
  const overviews = new Map<number, z.infer<typeof overviewSchema>>();
  const records = new Map<string, unknown>();
  for (const line of text.split("\n")) {
    const row = /^([0-9a-f]+):(.+)$/.exec(line);
    if (!row) continue;
    try { records.set(row[1], JSON.parse(row[2])); } catch { continue; }
  }

  // Flight shares data by row/path, including candidate objects reused across races.
  // Resolve data references only; module/lazy/action references are never evaluated.
  function dereference(value: unknown, seen = new Set<string>()): unknown {
    if (typeof value !== "string") return value;
    const reference = /^\$([0-9a-f]+)((?::[^:]+)*)$/.exec(value);
    if (!reference) return value;
    if (seen.has(value)) return undefined;
    const visited = new Set(seen).add(value);
    let target = records.get(reference[1]);
    for (const key of reference[2].split(":").slice(1)) {
      target = dereference(target, visited);
      if (key === "props" && Array.isArray(target) && target[0] === "$") {
        target = target[3];
      } else if (target && typeof target === "object" && Object.prototype.hasOwnProperty.call(target, key) && !["__proto__", "constructor", "prototype"].includes(key)) {
        target = (target as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }
    return dereference(target, visited);
  }

  function dataValue(value: unknown, ancestors = new Set<object>()): unknown {
    const target = dereference(value);
    if (typeof target === "string") return target.startsWith("$$") ? target.slice(1) : target;
    if (!target || typeof target !== "object") return target;
    if (ancestors.has(target)) return undefined;
    const visited = new Set(ancestors).add(target);
    if (Array.isArray(target)) return target.map((item) => dataValue(item, visited));
    return Object.fromEntries(Object.entries(target).map(([key, item]) => [key, dataValue(item, visited)]));
  }

  for (const parsed of records.values()) {
    const pending: unknown[] = [parsed];
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== "object") continue;
      if (!Array.isArray(value)) {
        if ("raceId" in value && "parties" in value) {
          const result = raceSchema.safeParse(dataValue(value));
          if (result.success) forecasts.set(result.data.raceId, result.data);
        }
        if ("stateAbb" in value && "electionType" in value) {
          const result = metaSchema.safeParse(dataValue(value));
          if (result.success && result.data.office === OFFICE_NAME[office] && dateText(result.data.race_date).startsWith("2026-11-03") && /general/i.test(result.data.electionType)) metadata.set(result.data.id, result.data);
        }
        if ("forecast" in value && "simulations" in value && "timeseries" in value) {
          const result = overviewSchema.safeParse(dataValue(value));
          if (result.success) overviews.set(result.data.toplineId, result.data);
        }
      }
      pending.push(...Object.values(value));
    }
  }

  const races: ParsedPage["races"] = [];
  const ratings: RatingCounts = { safeD: 0, likelyD: 0, leanD: 0, tossup: 0, leanR: 0, likelyR: 0, safeR: 0, other: 0 };
  let updatedAt = 0;
  for (const meta of metadata.values()) {
    const raw = forecasts.get(meta.id);
    if (!raw) unavailable();
    const forecast = readForecast(raw);
    const rating = publishedRating(raw.rating, forecast);
    const at = Date.parse(dateText(raw.updatedAt));
    if (!forecast.length || rating === undefined || !Number.isFinite(at)) unavailable();
    const district = office === "house" ? (/^(?:|at[ -]large|al)$/i.test(meta.district) ? 0 : Number(meta.district)) : null;
    if (district !== null && (!Number.isInteger(district) || district < 0)) unavailable();
    const key = seatKey({ office, state: meta.stateAbb, district, special: /special/i.test(meta.electionType) });
    races.push({ key, id: String(meta.id), race: { forecast, rating, updatedAt: at, candidates: null, call: null, counties: [], total: 0 } });
    updatedAt = Math.max(updatedAt, at);
    const side = forecast[0].party;
    if (rating === "tossup") ratings.tossup++;
    else if (side === "I") ratings.other++;
    else if (rating === null) ratings[side === "D" ? "safeD" : "safeR"]++;
    else if (rating.startsWith("lean-")) ratings[side === "D" ? "leanD" : "leanR"]++;
    else ratings[side === "D" ? "likelyD" : "likelyR"]++;
  }
  if (!races.length) unavailable();
  // DDHQ publishes governor race forecasts, but no aggregate governorship projection/history.
  if (office === "governor") return { races, updatedAt, ratings, history: [] };
  const officeId = metadata.values().next().value?.officeId;
  const overview = [...overviews.values()].find((row) => row.officeId === officeId && row.forecast.officeId === officeId);
  if (!overview) unavailable();
  const dem = overview.forecast.parties.find((p) => p.shortAbbrev === "D");
  const rep = overview.forecast.parties.find((p) => p.shortAbbrev === "R");
  if (!dem || !rep || dem.seats === undefined || rep.seats === undefined) unavailable();
  const totalSimulations = overview.simulations.reduce((sum, row) => sum + row.count, 0);
  const distribution = overview.simulations.flatMap((row) => {
    const seats = row.parties.find((p) => p.partyId === dem.partyId)?.seats;
    return seats === undefined || !totalSimulations ? [] : [{ seats, p: row.count / totalSimulations }];
  }).sort((a, b) => a.seats - b.seats);
  const history: ChamberPoint[] = overview.timeseries.map((row): ChamberPoint => {
    const d = row.parties.find((p) => p.shortAbbrev === "D");
    const r = row.parties.find((p) => p.shortAbbrev === "R");
    const date = Date.parse(dateText(row.date));
    if (!d || !r || d.seats === undefined || r.seats === undefined || !Number.isFinite(date)) unavailable();
    return [new Date(date).toISOString().slice(0, 10), d.winProbability, d.seats, r.seats];
  }).sort((a, b) => a[0].localeCompare(b[0]));
  const at = Date.parse(dateText(overview.forecast.updatedAt));
  if (!Number.isFinite(at)) unavailable();
  return {
    races, history, ratings, updatedAt: at,
    chamber: {
      dControl: dem.winProbability, dSeats: dem.seats, rSeats: rep.seats, ratings, distribution,
      notUp: office === "senate" ? { ...HOLDOVER.senate } : { D: 0, R: 0, other: 0 },
      majority: office === "senate" ? 51 : 218,
    },
  };
}

/** Three requests for all published projections, kept on this verified user's request only. */
export async function ddhqForecast(session: DdhqSession): Promise<DdhqForecastBundle> {
  const cookie = await votesSessionCookie(session);
  const pages = await Promise.all(OFFICES.map(async (office) => {
    const res = await votes(`/forecast/2026/${office}`, cookie);
    if (res.status === 401) throw new AccountError("The Votes sign-in expired. Connect it again.", 401);
    if (!res.ok) unavailable();
    return { office, ...readForecastPage(await res.text(), office) };
  }));
  const rows = pages.flatMap((page) => page.races);
  // This existing cache contains public seat-to-id metadata only, never forecast/result JSON.
  rememberRaceIds(rows);
  return {
    races: rows.map(({ key, race }) => ({ key, race })),
    overview: {
      source: "ddhq", updatedAt: Math.max(...pages.map((page) => page.updatedAt)),
      ratings: Object.fromEntries(pages.map((page) => [page.office, page.ratings])),
      chambers: Object.fromEntries(pages.filter((page) => page.chamber).map((page) => [page.office, page.chamber])),
      history: { house: pages[0].history, senate: pages[1].history, governor: [] },
    },
  };
}
