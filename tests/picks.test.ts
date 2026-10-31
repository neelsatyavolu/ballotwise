import { describe, expect, it } from "vitest";
import { signUp } from "../lib/auth/accounts";
import { saveGuide, trackedPicks, type GuideData } from "../lib/guides";
import { pickIn, sameCandidate, type GuidePick } from "../lib/midterms/picks";
import type { RaceSummary } from "../lib/midterms/races";
import { testDb } from "./sqlite-db";

const race = (names: string[], extra: Partial<RaceSummary> = {}) =>
  ({ id: 1, office: "senate", state: "TX", district: null, title: "TX Senate", reporting: 0, total: 0, rating: null, candidates: names.map((name) => ({ name, party: "", votes: 0, pct: 0, winner: false, incumbent: false })), ...extra }) as RaceSummary;

const pick = (candidates: string[], picks: string[], extra: Partial<GuidePick> = {}): GuidePick => ({
  guideId: "g1",
  kind: "office",
  candidates,
  match: { picks: picks.map((name, i) => ({ candidateId: `c${i}`, name, score: 80 })), runnerUpScore: 60, runnerUpName: null, closeCall: false, coverage: 1 },
  ...extra,
});

describe("sameCandidate", () => {
  it("matches across middle names, initials, suffixes, accents and nicknames in quotes", () => {
    expect(sameCandidate("John Cornyn", "John Cornyn")).toBe(true);
    expect(sameCandidate("James E. Smith Jr.", "James Smith")).toBe(true);
    expect(sameCandidate("José Núñez", "Jose Nunez")).toBe(true);
    expect(sameCandidate('Robert "Beto" O\'Rourke', "Robert O'Rourke")).toBe(true);
    expect(sameCandidate("J. Smith", "Jane Smith")).toBe(true);
  });
  it("doesn't match a different first name or surname", () => {
    expect(sameCandidate("Jane Smith", "Mark Smith")).toBe(false);
    expect(sameCandidate("Jane Smith", "Jane Smithers")).toBe(false);
  });
});

describe("pickIn", () => {
  it("names the race's candidate the guide picked", () => {
    const got = pickIn(race(["Ken Paxton", "James Talarico", "Ted Brown"]), [pick(["James Talarico", "Ken Paxton"], ["James Talarico"])]);
    expect(got?.names).toEqual(["James Talarico"]);
    expect(got?.pick.guideId).toBe("g1");
  });
  it("needs a second candidate from the guide in the race, so a shared name alone doesn't match", () => {
    expect(pickIn(race(["Jane Smith", "Bob Jones"]), [pick(["Jane Smith", "Ann Lee"], ["Jane Smith"])])).toBeNull();
  });
  it("matches an unopposed guide on its one candidate", () => {
    expect(pickIn(race(["Jane Smith"]), [pick(["Jane Smith"], ["Jane Smith"])])?.names).toEqual(["Jane Smith"]);
  });
  it("skips ballot measures, whose sides are only Yes and No", () => {
    expect(pickIn(race(["Yes", "No"], { office: "measure" }), [pick(["Yes", "No"], ["Yes"], { kind: "measure" })])).toBeNull();
  });
  it("keeps every pick in a multi-seat race", () => {
    const got = pickIn(race(["A Adams", "B Brown", "C Clark"]), [pick(["A Adams", "B Brown", "C Clark"], ["C Clark", "A Adams"])]);
    expect(got?.names).toEqual(["C Clark", "A Adams"]);
  });
  it("prefers the guide sharing the most candidates with the race", () => {
    const loose = pick(["Ann Lee", "Bob Jones", "Zed Zane"], ["Ann Lee"], { guideId: "loose" });
    const tight = pick(["Ann Lee", "Bob Jones", "Cy Cole"], ["Bob Jones"], { guideId: "tight" });
    expect(pickIn(race(["Ann Lee", "Bob Jones", "Cy Cole"]), [loose, tight])?.pick.guideId).toBe("tight");
  });
});

describe("trackedPicks", () => {
  const data = (date: string) =>
    ({
      query: "q",
      race: {
        title: "U.S. Senate",
        election: "General",
        date,
        jurisdiction: "Texas",
        office: { text: "t", sources: ["https://e.com"] },
        votingRule: null,
        candidates: [
          { id: "a", name: "Ann Lee", party: null, ballotDesignation: null, incumbent: false },
          { id: "b", name: "Bob Jones", party: null, ballotDesignation: null, incumbent: false },
        ],
        issues: [{ id: "tax", title: "Taxes", question: "q", sideA: "a", sideB: "b" }],
        sources: ["https://e.com"],
      },
      profiles: {
        a: { summary: "s", background: [], positions: [{ issueId: "tax", stance: 2, summary: "", quote: null, sources: [] }], record: [], funding: null, endorsements: [], website: null },
        b: { summary: "s", background: [], positions: [{ issueId: "tax", stance: -2, summary: "", quote: null, sources: [] }], record: [], funding: null, endorsements: [], website: null },
      },
      answers: { tax: { stance: 2, weight: 2 } },
      overrides: {},
    }) as unknown as GuideData;

  it("lists the user's matched guides for election day with every candidate's name", async () => {
    const db = testDb();
    const a = (await signUp(db, "a@example.com", "a long password", 1)).user;
    const b = (await signUp(db, "b@example.com", "a long password", 1)).user;
    await saveGuide(db, a.id, "guide-0001", data("2026-11-03"), 10);
    await saveGuide(db, a.id, "guide-0002", data("2024-11-05"), 10);
    const got = await trackedPicks(db, a.id, "2026-11-03");
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ guideId: "guide-0001", kind: "office", candidates: ["Ann Lee", "Bob Jones"] });
    expect(got[0].match.picks.map((p) => p.name)).toEqual(["Ann Lee"]);
    expect(await trackedPicks(db, b.id, "2026-11-03")).toHaveLength(0);
  });
});
