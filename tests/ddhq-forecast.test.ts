import { afterEach, describe, expect, it, vi } from "vitest";
import { ddhqForecast, readForecastPage } from "../lib/ddhq/forecast";
import { votesSessionCookie } from "../lib/ddhq/clerk";
import { clearSeatCache, votes } from "../lib/ddhq/votes";
import { projection } from "../lib/midterms/forecastTab";

vi.mock("../lib/ddhq/clerk", () => ({ votesSessionCookie: vi.fn(async () => "__session=private-session") }));
vi.mock("../lib/ddhq/votes", async (original) => ({ ...await original<typeof import("../lib/ddhq/votes")>(), votes: vi.fn() }));

afterEach(() => { vi.clearAllMocks(); clearSeatCache(); });

function page(office: "house" | "senate" | "governor", rating = "Lean") {
  const officeId = office === "house" ? 2 : office === "senate" ? 1 : 3;
  const parties = [
    { partyId: 1, shortAbbrev: "D", winProbability: 0.7, candidates: [{ name: "A Person" }] },
    { partyId: 2, shortAbbrev: "R", winProbability: 0.3, candidates: [{ name: "B Person" }] },
  ];
  const row = { raceId: 9001, parties, rating, updatedAt: "2026-10-30T14:00:00Z" };
  const metadata = { id: 9001, stateAbb: "AA", office: office === "senate" ? "US Senate" : office === "house" ? "US House" : "Governor", officeId: String(officeId), district: office === "house" ? "At-Large" : "", electionType: "General Election", race_date: "2026-11-03" };
  const chamberParties = [{ partyId: 1, shortAbbrev: "D", winProbability: 0.61, seats: 52 }, { partyId: 2, shortAbbrev: "R", winProbability: 0.39, seats: 48 }];
  const overview = { toplineId: 100 + officeId, officeId, forecast: { officeId, stateId: null, year: 2026, parties: chamberParties, updatedAt: row.updatedAt }, timeseries: [{ date: "2026-10-29", parties: chamberParties }], simulations: [{ count: 600, parties: [{ partyId: 1, seats: 52 }, { partyId: 2, seats: 48 }] }, { count: 400, parties: [{ partyId: 1, seats: 49 }, { partyId: 2, seats: 51 }] }] };
  return [
    "0:I[\"client-chunk\"]",
    `1:${JSON.stringify(["$", "div", null, { [office === "governor" ? "governorForecasts" : "forecasts"]: [row], racesViz: [metadata], ...(office === "governor" ? {} : { overviews: [overview] }) }])}`,
    `2:${JSON.stringify({ forecasts: "$1:props:governorForecasts", clientState: { token: "must-not-leave-server", email: "private@example.test" } })}`,
  ].join("\n");
}

describe("published DDHQ forecast payload", () => {
  it("uses published chamber numbers and history rather than simulating race odds", () => {
    const read = readForecastPage(page("senate"), "senate");
    expect(read.chamber).toMatchObject({ dControl: 0.61, dSeats: 52, rSeats: 48, notUp: { D: 34, R: 31, other: 0 } });
    expect(read.chamber?.distribution).toEqual([{ seats: 49, p: 0.4 }, { seats: 52, p: 0.6 }]);
    expect(read.history).toEqual([["2026-10-29", 0.61, 52, 48]]);
    expect(read.races[0]).toMatchObject({ key: "senate:AA::g", id: "9001", race: { rating: "lean-d", candidates: null, forecast: [{ name: "A Person", party: "D", probability: 0.7 }, { name: "B Person", party: "R", probability: 0.3 }] } });
    expect(JSON.stringify(read)).not.toContain("must-not-leave-server");
    expect(JSON.stringify(read)).not.toContain("private@example.test");
  });

  it("reads governor records without fabricating an aggregate projection", () => {
    const read = readForecastPage(page("governor"), "governor");
    expect(read.races).toHaveLength(1);
    expect(read.chamber).toBeUndefined();
    expect(read.history).toEqual([]);
    const tally = { D: 6, R: 8, other: 0, total: 50, majority: 26, uncalled: 36 };
    expect(projection([], "governor", tally, undefined, "ddhq")).toBeNull();
    expect(projection([], "governor", tally, undefined)).not.toBeNull();
  });

  it("preserves published Safe categories and maps at-large seats", () => {
    const read = readForecastPage(page("house", "Safe"), "house");
    expect(read.races[0].key).toBe("house:AA:0:g");
    expect(read.races[0].race.rating).toBeNull();
    expect(read.chamber?.ratings.safeD).toBe(1);
  });

  it("accepts React's serialized Date markers", () => {
    const encoded = page("senate").replaceAll('"2026-', '"$D2026-');
    expect(readForecastPage(encoded, "senate").updatedAt).toBe(Date.parse("2026-10-30T14:00:00Z"));
  });

  it("does not replace the chamber with a different office or race sparkline", () => {
    const body = page("senate");
    const row = JSON.parse(body.split("\n")[1].slice(2));
    const wrong = structuredClone(row[3].overviews[0]);
    wrong.toplineId = 999;
    wrong.officeId = wrong.forecast.officeId = 2;
    wrong.forecast.parties[0].winProbability = 0.99;
    const sparkline = { forecast: wrong.forecast, timeseries: wrong.timeseries, simulations: wrong.simulations };
    expect(readForecastPage(body + "\n3:" + JSON.stringify({ overviews: [wrong], sparkline }), "senate").chamber?.dControl).toBe(0.61);
  });

  it.each(["<html>checkpoint</html>", "1:{}", page("senate").replace('"raceId":9001', '"raceId":9002'), page("senate", "unknown")])("fails closed on missing or changed forecast records", (body) => {
    expect(() => readForecastPage(body, "senate")).toThrowError(expect.objectContaining({ status: 502 }));
  });

  it("gets all offices under one freshly minted user session", async () => {
    vi.mocked(votes).mockImplementation(async (path) => {
      const office = path.split("/").at(-1) as "house" | "senate" | "governor";
      return new Response(page(office), { headers: { "content-type": "text/x-component" } });
    });
    const result = await ddhqForecast({ clientToken: "client-for-mint-only", sessionId: "session-id" });
    expect(votesSessionCookie).toHaveBeenCalledTimes(1);
    expect(vi.mocked(votes).mock.calls).toEqual([
      ["/forecast/2026/house", "__session=private-session"],
      ["/forecast/2026/senate", "__session=private-session"],
      ["/forecast/2026/governor", "__session=private-session"],
    ]);
    expect(result.races).toHaveLength(3);
    expect(Object.keys(result.overview.chambers!)).toEqual(["house", "senate"]);
    expect(result.overview.source).toBe("ddhq");
    expect(result.overview.history?.governor).toEqual([]);
    expect(result.overview.ratings?.governor).toMatchObject({ leanD: 1, safeD: 0, safeR: 0 });
    expect(JSON.stringify(result)).not.toContain("client-for-mint-only");
    expect(result.races[0]).not.toHaveProperty("id");
  });

  it.each([401, 429, 502])("keeps upstream %s failure classification", async (status) => {
    vi.mocked(votes).mockResolvedValue(new Response("{}", { status }));
    await expect(ddhqForecast({ clientToken: "client", sessionId: "s" })).rejects.toMatchObject({ status: status === 401 ? 401 : 502 });
  });
});
