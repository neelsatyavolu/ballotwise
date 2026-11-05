import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signUp } from "../lib/auth/accounts";
import { applyDesk, deskFor, isDesk } from "../lib/ddhq/apply";
import { ddhqResultsSource, deleteDdhqSession, setDdhqResultsSource, storeDdhqSession } from "../lib/ddhq/vault";
import type { DdhqRace } from "../lib/ddhq/votes";
import type { RaceSummary } from "../lib/midterms/races";
import { reportingText } from "../components/midterms/reporting";
import { testDb } from "./sqlite-db";

const KEY = randomBytes(32).toString("base64");

const civic = (): RaceSummary => ({
  id: 1, state: "GA", office: "senate", district: null, title: "US Senate", total: 10_000, reporting: 40, rating: null, calledFor: null, signal: null,
  candidates: [
    { name: "Dana Nominee", party: "Democratic", votes: 6000, pct: 60, winner: false, incumbent: false },
    { name: "Riley Opponent", party: "Republican", votes: 4000, pct: 40, winner: false, incumbent: false },
  ],
});
const desk = (): DdhqRace => ({
  forecast: [{ name: "Dana Nominee", party: "D", probability: 0.7 }, { name: "Riley Opponent", party: "R", probability: 0.3 }],
  rating: "lean-d", updatedAt: 1, call: { name: "Riley Opponent", at: "2026-11-04T05:00:00Z" }, total: 9000, reporting: 30, expected: 30_000, counties: [],
  candidates: [
    { name: "Dana Nominee", party: "Democratic", votes: 5000, pct: 55.6, winner: false },
    { name: "Riley Opponent", party: "Republican", votes: 4000, pct: 44.4, winner: false },
  ] as DdhqRace["candidates"],
});
const recent = Date.now() - 10_000;

describe("results source", () => {
  it("auto lets civicAPI's recent count stand in where it has more votes", () => {
    expect(applyDesk(civic(), desk(), recent, "auto")).toMatchObject({ total: 10_000, countFrom: "civic" });
  });

  it("DDHQ only keeps DDHQ's count even where civicAPI has more votes in", () => {
    const next = applyDesk(civic(), desk(), recent, "ddhq");
    expect(next).toMatchObject({ total: 9000, reporting: 30, expected: 30_000, calledFor: "Riley Opponent" });
    expect(next.countFrom).toBeUndefined();
  });

  it("civicAPI only keeps civicAPI's count and calls, with DDHQ's forecast", () => {
    const next = applyDesk(civic(), desk(), recent, "civic");
    expect(next).toMatchObject({ total: 10_000, reporting: 40 });
    expect(next.candidates.some((c) => c.winner)).toBe(false);
    expect(isDesk(next)).toBe(false);
    expect(deskFor(next)?.forecast).toHaveLength(2);
  });

  it("is stored with the DDHQ connection, defaults to auto, and goes with it", async () => {
    const db = testDb();
    const { user } = await signUp(db, "a@example.com", "a long password", 1);
    expect(await ddhqResultsSource(db, user.id)).toBeNull();
    expect(await setDdhqResultsSource(db, user.id, "ddhq")).toBe(false);
    await storeDdhqSession(db, KEY, user.id, "voter@example.com", { clientToken: "t", sessionId: "s" }, 5);
    expect(await ddhqResultsSource(db, user.id)).toBe("auto");
    expect(await setDdhqResultsSource(db, user.id, "ddhq")).toBe(true);
    // Signing in to Votes again keeps the choice.
    await storeDdhqSession(db, KEY, user.id, "voter@example.com", { clientToken: "t2", sessionId: "s2" }, 6);
    expect(await ddhqResultsSource(db, user.id)).toBe("ddhq");
    await deleteDdhqSession(db, user.id);
    expect(await ddhqResultsSource(db, user.id)).toBeNull();
  });
});

describe("reportingText with DDHQ's expected vote", () => {
  const race = { total: 951_000, reporting: 99, candidates: [], expected: 836_948 };
  it("says it's a share of the expected vote, not precincts", () => {
    expect(reportingText(race).long).toBe("99% of expected vote, more may remain");
    expect(reportingText({ ...race, reporting: 72 }).long).toBe("72% of expected vote");
    expect(reportingText({ ...race, expected: undefined }).long).toBe("Precincts in, ballots may remain");
  });
});
