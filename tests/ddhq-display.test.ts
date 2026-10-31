import { describe, expect, it } from "vitest";
import { deskRaces, selectDeskDisplay } from "../lib/ddhq/display";
import { EMPTY_DESK, type DeskData } from "../lib/ddhq/store";
import { balance, type RaceSummary } from "../lib/midterms/races";
import type { Overview } from "../lib/midterms/view";
import type { DdhqRace } from "../lib/ddhq/votes";

const key = "senate:GA::g";
const race: RaceSummary = {
  id: 1, office: "senate", state: "GA", district: null, title: "US Senate", total: 100, reporting: 50,
  candidates: [{ name: "Public winner", party: "Republican", votes: 100, pct: 100, winner: true, incumbent: false }],
  rating: "likely-r", calledFor: "Public winner", call: { id: 1, at: 10, winner: "Public winner", replaced: null, withdrawn: false },
};
const raw: Overview = { races: [race], balance: balance([race]), fetchedAt: 10, stale: true, ratings: { updatedAt: 10 } };
const forecast: DdhqRace = { forecast: [{ name: "Private nominee", party: "D", probability: 0.8 }], rating: "likely-d", candidates: null, call: null, total: 0, counties: [] };
const privateOverview = { source: "ddhq" as const, updatedAt: 20, chambers: {}, history: null };
const desk = (over: Partial<DeskData> = {}): DeskData & { enabled: boolean } => ({ ...EMPTY_DESK, enabled: true, ...over });

describe("DDHQ first-paint policy", () => {
  it("withholds seeded public projections/results while the connected source is idle or loading", () => {
    for (const forecastStatus of ["idle", "loading"] as const) {
      expect(selectDeskDisplay("/api/midterms", raw, desk({ forecastStatus }))).toMatchObject({ data: null, loading: true });
      expect(selectDeskDisplay("/api/midterms/forecast", { updatedAt: 1, chambers: {}, history: null }, desk({ forecastStatus }))).toMatchObject({ data: null, loading: true });
    }
  });

  it("shows all forecasts immediately without waiting for or borrowing public vote leaders", () => {
    const state = desk({ forecast: privateOverview, forecastStatus: "ready", races: new Map([[key, forecast]]) });
    expect(selectDeskDisplay("/api/midterms", raw, state).loading).toBe(true);
    const view = selectDeskDisplay("/api/midterms", raw, state, { forecastOnly: true });
    expect(view.loading).toBe(false);
    expect(view.data?.races[0].signal?.forecast?.odds.D).toBe(0.8);
    expect(view.data?.races[0].calledFor).toBeNull();
    expect(view.data?.races[0].total).toBe(0);
    expect(view.data?.races[0].candidates.every((candidate) => !candidate.winner)).toBe(true);
    expect(raw.races[0].total).toBe(100);
    expect(raw.races[0].candidates[0].winner).toBe(true);
  });

  it("reveals only ready private counts and their own check time", () => {
    const state = desk({ forecast: privateOverview, forecastStatus: "ready", countsReady: new Set([key]), countsFetchedAt: 30,
      races: new Map([[key, { ...forecast, candidates: [{ name: "Private nominee", party: "Democratic", votes: 42, pct: 100, winner: false, incumbent: false }], total: 42 }]]) });
    const view = selectDeskDisplay("/api/midterms", raw, state);
    expect(view).toMatchObject({ loading: false, error: null, privateSource: true });
    expect(view.data).toMatchObject({ fetchedAt: 30, stale: false });
    expect(view.data?.races[0]).toMatchObject({ total: 42, calledFor: null });
    expect(raw.fetchedAt).toBe(10);
  });

  it("keeps election results moving when the forecast is slow, without inserting public projections", () => {
    const state = desk({ forecastStatus: "loading", countsReady: new Set([key]), countsFetchedAt: 30,
      races: new Map([[key, { forecast: [], candidates: [{ name: "DDHQ leader", party: "Democratic", votes: 42, pct: 100, winner: false, incumbent: false }], total: 42, call: null, counties: [] }]]) });
    const view = selectDeskDisplay("/api/midterms", raw, state);
    expect(view.loading).toBe(false);
    expect(view.data?.races[0].total).toBe(42);
    expect(view.data?.races[0].signal).toBeNull();
    expect(view.data?.races[0].rating).toBeNull();
    expect(view.data?.forecastSource).toBe("ddhq");
    expect(selectDeskDisplay("/api/midterms/forecast", null, state).loading).toBe(true);
  });

  it("permits the public fallback only after the relevant private request fails", () => {
    const state = desk({ forecastStatus: "error", forecastError: "Forecast unavailable", countsFailed: new Set([key]), countsError: "Results unavailable" });
    const view = selectDeskDisplay("/api/midterms", raw, state);
    expect(view).toMatchObject({ data: raw, loading: false, error: "Results unavailable", privateSource: false });
    expect(selectDeskDisplay("/api/midterms/forecast", privateOverview, desk({ forecastStatus: "error" })).data).toBe(privateOverview);
  });

  it("keeps the last successful private data while a refresh is in flight", () => {
    expect(selectDeskDisplay("/api/midterms/forecast", null, desk({ forecast: privateOverview, forecastStatus: "loading" })).data).toBe(privateOverview);
  });

  it("does not mix civic vote-drop history or pending-call state with private detail counts", () => {
    const detail = { race: { ...race, callPending: true as const }, fetchedAt: 10, stale: true,
      history: [{ at: 9, total: 100, leadName: "Public winner", leadParty: "Republican", margin: 100, reporting: 50, corrected: false }],
    };
    const before = structuredClone(detail);
    const state = desk({ forecast: privateOverview, forecastStatus: "ready", countsReady: new Set([key]), countsFetchedAt: 30,
      races: new Map([[key, { ...forecast, candidates: [{ name: "Private nominee", party: "Democratic", votes: 42, pct: 100, winner: false, incumbent: false }], total: 42 }]]) });
    const view = selectDeskDisplay("/api/midterms/race/1", detail, state);
    expect(view.data?.history).toEqual([]);
    expect(view.data?.race).toMatchObject({ total: 42, calledFor: null, call: null });
    expect(view.data?.race.callPending).toBeUndefined();
    expect(view.data?.fetchedAt).toBe(30);
    expect(detail).toEqual(before);
  });

  it.each([false, true])("preserves civic detail history when counts fall back (private forecast: %s)", (withForecast) => {
    const detail = { race: { ...race, callPending: true as const }, fetchedAt: 10, stale: true,
      history: [{ at: 9, total: 100, leadName: "Public winner", leadParty: "Republican", margin: 100, reporting: 50, corrected: false }],
    };
    const state = desk({ forecast: withForecast ? privateOverview : null, forecastStatus: withForecast ? "ready" : "error",
      countsFailed: new Set([key]), countsError: "Results unavailable", races: withForecast ? new Map([[key, forecast]]) : new Map(),
    });
    const view = selectDeskDisplay("/api/midterms/race/1", detail, state);
    expect(view.data?.history).toBe(detail.history);
    expect(view.data?.race.total).toBe(100);
    expect(view.data?.race.callPending).toBe(true);
    expect(view.error).toBe("Results unavailable");
    expect(selectDeskDisplay("/api/midterms/race/1", detail, { ...state, enabled: false }).data).toBe(detail);
  });

  it("does not wait for another office, and leaves disconnected and measure views public", () => {
    const mixed = { ...raw, races: [race, { ...race, id: 2, office: "house" as const, district: 1 }] };
    const state = desk({ forecast: privateOverview, forecastStatus: "ready", countsFailed: new Set([key]) });
    expect(selectDeskDisplay("/api/midterms", mixed, state, { office: "senate" }).loading).toBe(false);
    expect(selectDeskDisplay("/api/midterms", mixed, state).loading).toBe(true);
    expect(selectDeskDisplay("/api/midterms", raw, { ...state, enabled: false }).data).toBe(raw);
    expect(selectDeskDisplay("/api/midterms", raw, desk(), { office: "measure" }).data).toBe(raw);
    expect(deskRaces("/api/midterms", mixed, "senate")).toEqual([race]);
  });
});
