import { describe, expect, it } from "vitest";
import { extractJson } from "../lib/json";
import { agreement, interviewMatchPhase, MATCH_WAIT_MS, matchCandidate } from "../lib/match";
import { alignPositions, keepRetrievedSources } from "../lib/profile";
import { normalizeUrl } from "../lib/url";
import { profileSchema, raceResultSchema, type Issue, type Profile } from "../lib/schema";

const issues: Issue[] = [
  { id: "housing", title: "Housing", question: "q", sideA: "a", sideB: "b" },
  { id: "transit", title: "Transit", question: "q", sideA: "a", sideB: "b" },
  { id: "taxes", title: "Taxes", question: "q", sideA: "a", sideB: "b" },
];

describe("extractJson", () => {
  it("reads a fenced block surrounded by prose", () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```\nDone.')).toEqual({ a: 1 });
  });
  it("reads a bare object", () => {
    expect(extractJson('noise {"a":{"b":2}} trailing')).toEqual({ a: { b: 2 } });
  });
  it("strips inline citation markers", () => {
    expect(extractJson('{"a":"x"[[1]](https://e.com/p)}')).toEqual({ a: "x" });
  });
  it("throws when there is no object", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("interviewMatchPhase", () => {
  const base = { hasMatch: false, fromInterview: false, matchError: null, values: "done", waitedMs: 0 };
  it("keeps matching only until the wait expires, then becomes retryable", () => {
    expect(interviewMatchPhase(base)).toBe("matching");
    expect(interviewMatchPhase({ ...base, waitedMs: MATCH_WAIT_MS - 1 })).toBe("matching");
    expect(interviewMatchPhase({ ...base, waitedMs: MATCH_WAIT_MS })).toBe("slow");
  });
  it("stops on a recorded failure, a real match, or no comparable answers", () => {
    expect(interviewMatchPhase({ ...base, matchError: "Grok returned an error." })).toBe("failed");
    expect(interviewMatchPhase({ ...base, hasMatch: true })).toBe("ready");
    expect(interviewMatchPhase({ ...base, fromInterview: true })).toBe("insufficient");
    expect(interviewMatchPhase({ ...base, values: "none" })).toBe("prompt");
  });
});

describe("agreement", () => {
  it("is 1 for identical stances and 0 for opposite ends", () => {
    expect(agreement(1, 1)).toBe(1);
    expect(agreement(-2, 2)).toBe(0);
    expect(agreement(0, 2)).toBe(0.5);
  });
});

describe("matchCandidate", () => {
  const ids = issues.map((i) => i.id);

  it("weights issues by importance and ignores skipped ones", () => {
    const m = matchCandidate("c", { housing: 2, transit: -2, taxes: 0 }, ids, {
      housing: { stance: 2, weight: 3 },
      transit: { stance: 2, weight: 1 },
      taxes: { stance: null, weight: 3 },
    });
    expect(m.score).toBe(75); // (3*1 + 1*0) / 4
    expect(m.coverage).toBe(1);
  });

  it("excludes unknown candidate stances from the score but reports coverage", () => {
    const m = matchCandidate("c", { housing: 2, transit: null }, ids, {
      housing: { stance: 2, weight: 1 },
      transit: { stance: 0, weight: 1 },
    });
    expect(m.score).toBe(100);
    expect(m.coverage).toBe(0.5);
  });

  it("returns a null score when nothing can be compared", () => {
    expect(matchCandidate("c", {}, ids, {}).score).toBeNull();
  });

  it("applies voter overrides, including clearing a stance", () => {
    const answers = { housing: { stance: 2, weight: 1 }, transit: { stance: 2, weight: 1 } } as const;
    const m = matchCandidate("c", { housing: -2, transit: 2 }, ids, answers, { c: { housing: 2, transit: null } });
    expect(m.score).toBe(100);
    expect(m.issues.find((i) => i.issueId === "transit")?.overridden).toBe(true);
    expect(m.coverage).toBe(0.5);
  });

  it("does not mutate its inputs", () => {
    const stances = Object.freeze({ housing: 1 });
    const answers = Object.freeze({ housing: Object.freeze({ stance: 1, weight: 2 as const }) });
    expect(() => matchCandidate("c", stances, ids, answers)).not.toThrow();
  });
});

describe("alignPositions", () => {
  const base: Profile = {
    summary: "s",
    background: [],
    record: [],
    funding: null,
    endorsements: [],
    website: null,
    positions: [
      { issueId: "transit", stance: 1, summary: "Supports buses.", quote: null, sources: ["https://e.com"] },
      { issueId: "housing", stance: -1, summary: "Unsourced guess.", quote: null, sources: [] },
      { issueId: "made-up", stance: 2, summary: "x", quote: null, sources: ["https://e.com"] },
    ],
  };

  it("returns one position per issue in race order and drops unsourced stances", () => {
    const out = alignPositions(base, issues);
    expect(out.positions.map((p) => p.issueId)).toEqual(["housing", "transit", "taxes"]);
    expect(out.positions[0].stance).toBeNull();
    expect(out.positions[1].stance).toBe(1);
    expect(out.positions[2].stance).toBeNull();
    expect(base.positions).toHaveLength(3);
  });
});

describe("schemas", () => {
  it("rejects a sourced claim with no sources", () => {
    const bad = { summary: "s", background: [{ text: "t", sources: [] }], positions: [], record: [], funding: null, endorsements: [], website: null };
    expect(profileSchema.safeParse(bad).success).toBe(false);
  });
  it("accepts an ambiguous-election result", () => {
    const r = raceResultSchema.safeParse({
      kind: "choose",
      options: [
        { label: "Mayor", query: "San Jose mayor 2026", date: null },
        { label: "Council District 3", query: "San Jose council district 3 2026", date: "2026-11-03" },
      ],
    });
    expect(r.success).toBe(true);
  });
});

describe("keepRetrievedSources", () => {
  const profile: Profile = {
    summary: "s",
    background: [
      { text: "real", sources: ["https://www.example.com/a/?utm_source=x"] },
      { text: "invented", sources: ["https://made-up.org/x"] },
    ],
    record: [],
    funding: { text: "f", sources: ["https://made-up.org/f"] },
    endorsements: [],
    website: null,
    positions: [{ issueId: "housing", stance: 1, summary: "x", quote: null, sources: ["https://made-up.org/p"] }],
  };

  it("drops citations that were never retrieved and claims left without any", () => {
    const out = keepRetrievedSources(profile, new Set([normalizeUrl("https://example.com/a")]));
    expect(out.background.map((b) => b.text)).toEqual(["real"]);
    expect(out.funding).toBeNull();
    expect(alignPositions(out, issues).positions[0].stance).toBeNull();
  });

  it("applies the same rule to a judge's evaluations", () => {
    const judge = { ...profile, evaluations: [{ text: "real", sources: ["https://example.com/a"] }, { text: "invented", sources: ["https://made-up.org/e"] }] };
    expect(keepRetrievedSources(judge, new Set([normalizeUrl("https://example.com/a")])).evaluations?.map((e) => e.text)).toEqual(["real"]);
  });

  it("leaves the profile alone when no retrieval data is available", () => {
    expect(keepRetrievedSources(profile, new Set())).toBe(profile);
  });
});

describe("balanceSides", () => {
  it("swaps sides per coin flip without touching the original", async () => {
    const { balanceSides } = await import("../lib/profile");
    const race = { issues: [{ ...issues[0], sideA: "x", sideB: "y" }, { ...issues[1], sideA: "x", sideB: "y" }] } as never;
    const flips = [0.2, 0.8];
    const out = balanceSides(race, () => flips.shift()!);
    expect(out.issues.map((i: Issue) => i.sideA)).toEqual(["x", "y"]);
    expect((race as { issues: Issue[] }).issues[1].sideA).toBe("x");
  });
});

describe("headline match", () => {
  it("prefers the voter's own answers over interview ones and flags close calls", async () => {
    const { effectiveAnswers, headlineMatch } = await import("../lib/match");
    const answers = effectiveAnswers({ housing: { stance: -2, weight: 1 } }, { housing: { stance: 2, weight: 3 }, transit: { stance: 2, weight: 2 } });
    expect(answers.housing).toEqual({ stance: -2, weight: 1 });
    const cands = [{ id: "a", name: "Ann" }, { id: "b", name: "Bob" }];
    const stances = { a: { housing: -2, transit: 2 }, b: { housing: 2, transit: -2 } };
    const m = headlineMatch(cands, stances, ["housing", "transit"], answers);
    expect(m).toMatchObject({ picks: [{ name: "Ann", score: 100 }], runnerUpScore: 0, closeCall: false });
    const tie = headlineMatch(cands, { a: { housing: 0 }, b: { housing: 0 } }, ["housing"], answers);
    expect(tie?.closeCall).toBe(true);
    expect(headlineMatch(cands, stances, ["housing"], {})).toBeNull();
  });

  it("picks one candidate per seat", async () => {
    const { headlineMatch, joinNames } = await import("../lib/match");
    const cands = [{ id: "a", name: "Ann" }, { id: "b", name: "Bob" }, { id: "c", name: "Cy" }];
    const stances = { a: { housing: 2 }, b: { housing: -2 }, c: { housing: 1 } };
    const m = headlineMatch(cands, stances, ["housing"], { housing: { stance: 2, weight: 1 } }, {}, 2);
    expect(m?.picks.map((p) => p.name)).toEqual(["Ann", "Cy"]);
    expect(m).toMatchObject({ runnerUpName: "Bob", runnerUpScore: 0, closeCall: false });
    expect(headlineMatch(cands, stances, ["housing"], { housing: { stance: 2, weight: 1 } }, {}, 5)?.picks).toHaveLength(3);
    expect(joinNames(["Ann", "Bob", "Cy"])).toBe("Ann, Bob and Cy");
  });

  it("reads the seat count from the race or its voting rule", async () => {
    const { seatsOf } = await import("../lib/schema");
    expect(seatsOf({ seats: 3, votingRule: null })).toBe(3);
    expect(seatsOf({ votingRule: "Vote for no more than 2" })).toBe(2);
    expect(seatsOf({ votingRule: "Vote for up to three" })).toBe(3);
    expect(seatsOf({ votingRule: "Two seats open" })).toBe(2);
    expect(seatsOf({ votingRule: "Top two from the primary" })).toBe(1);
    expect(seatsOf({ votingRule: null })).toBe(1);
  });
});
