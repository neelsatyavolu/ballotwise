import { describe, expect, it } from "vitest";
import { categoryOf } from "../lib/categories";
import { ballotPrompt, profilePrompt, racePrompt } from "../lib/prompts";
import { ballotContestsSchema, raceResultSchema, raceSchema, type Race } from "../lib/schema";

describe("categoryOf", () => {
  it("sorts offices by level", () => {
    expect(categoryOf("office", "federal")).toBe("federal-state");
    expect(categoryOf("office", "state")).toBe("federal-state");
    expect(categoryOf("office", "city")).toBe("local");
    expect(categoryOf("office", "school")).toBe("local");
    expect(categoryOf("office", "judicial")).toBe("judges");
  });
  it("splits measures into state propositions and local measures", () => {
    expect(categoryOf("measure", "state")).toBe("propositions");
    expect(categoryOf("measure", "county")).toBe("local-measures");
    expect(categoryOf("measure", "special-district")).toBe("local-measures");
  });
  it("puts guides with no recorded level under Other", () => {
    expect(categoryOf("office", null)).toBe("other");
  });
  it("files a researched judge under Judges even without a level", () => {
    expect(categoryOf("judicial", null)).toBe("judges");
  });
});

describe("ballot contests", () => {
  it("treats contests without a kind as offices", () => {
    const parsed = ballotContestsSchema.parse({
      elections: [{ name: "General", date: "2026-11-03", contests: [
        { label: "Mayor", query: "mayor 2026", level: "city" },
        { label: "Proposition 1", query: "prop 1 2026", level: "state", kind: "measure" },
      ] }],
    });
    expect(parsed.elections[0].contests.map((c) => c.kind)).toEqual(["office", "measure"]);
  });
  it("fits a long ballot with a retention vote for every appellate justice", () => {
    const contests = Array.from({ length: 55 }, (_, i) => ({ label: `Contest ${i}`, query: `contest ${i} 2026`, level: "judicial" as const }));
    expect(ballotContestsSchema.safeParse({ elections: [{ name: "General", date: "2026-11-03", contests }] }).success).toBe(true);
  });
});

describe("ballot search", () => {
  const districts = { state: "California", county: "Santa Clara County", place: "San Jose", congressional: null, stateSenate: null, stateHouse: null, schoolDistrict: null };
  it("asks for every judge, retention votes included", () => {
    const prompt = ballotPrompt("1 Main St, San Jose, CA", districts);
    expect(prompt).toMatch(/retention vote/i);
    expect(prompt).not.toMatch(/leave out[^.\n]*retention/i);
  });
  it("lets only a judge's race go without issues", () => {
    const base = { title: "Justice", election: "General", date: "2026-11-03", jurisdiction: "California", office: { text: "Hears appeals.", sources: ["https://example.gov/c"] },
      votingRule: null, candidates: [{ id: "judge", name: "A Judge", party: null, ballotDesignation: null, incumbent: true }], issues: [], sources: ["https://example.gov/c"] };
    expect(raceResultSchema.safeParse({ kind: "race", race: { ...base, kind: "judicial" } }).success).toBe(true);
    expect(raceResultSchema.safeParse({ kind: "race", race: base }).success).toBe(false);
  });
  it("researches a judge's record and evaluations instead of issue stances", () => {
    const judge: Race = { kind: "judicial", title: "California Supreme Court", election: "General", date: "2026-11-03", jurisdiction: "California",
      office: { text: "Hears appeals.", sources: ["https://example.gov/c"] }, votingRule: null, seats: 1,
      candidates: [{ id: "judge", name: "A Judge", party: null, ballotDesignation: null, incumbent: true }], issues: [], sources: ["https://example.gov/c"] };
    const prompt = profilePrompt(judge, judge.candidates[0]);
    expect(prompt).toContain('"evaluations"');
    expect(prompt).not.toContain("scored from -2 to +2");
  });
  it("tells race research how to lay out a retention vote", () => {
    expect(racePrompt("Justice Kelli Evans, California Supreme Court, November 3 2026")).toMatch(/retention vote[^\n]*only candidate/i);
  });
});

describe("measure research", () => {
  const measure: Race = {
    kind: "measure", title: "Proposition 1: Parks Bond", election: "General", date: "2026-11-03", jurisdiction: "California",
    office: { text: "Borrows $5 billion for parks.", sources: ["https://example.gov/p1"] }, votingRule: null, seats: 1,
    candidates: [
      { id: "yes", name: "Yes on 1", party: null, ballotDesignation: "A yes vote means: the state borrows for parks.", incumbent: false },
      { id: "no", name: "No on 1", party: null, ballotDesignation: "A no vote means: no new borrowing.", incumbent: false },
    ],
    issues: [{ id: "debt", title: "Debt", question: "q", sideA: "a", sideB: "b" }],
    sources: ["https://example.gov/p1"],
  };
  it("researches each side from its own campaign, not as a candidate", () => {
    expect(profilePrompt(measure, measure.candidates[0])).toContain("official ballot argument in favor of");
    expect(profilePrompt(measure, measure.candidates[1])).toContain("official ballot argument against");
    expect(profilePrompt({ ...measure, kind: undefined }, measure.candidates[0])).not.toContain("official ballot argument");
  });
  it("accepts official titles, ballot-label sentences and analyses at their real length", () => {
    const issue = (id: string) => ({ id, title: "Taxes", question: "q", sideA: "a", sideB: "b" });
    const long = {
      ...measure,
      title: "Proposition 41: Prohibits New State Taxes That Exclude Revenues from State Spending Limit; Requires Audits for New State Special Taxes",
      office: { text: "x".repeat(900), sources: ["https://example.gov/p41"] },
      candidates: measure.candidates.map((c) => ({ ...c, ballotDesignation: `A ${c.id} vote means: ${"y".repeat(230)}` })),
      issues: [issue("tax-a"), issue("tax-b"), issue("tax-c")],
    };
    expect(raceSchema.safeParse(long).error?.issues).toBeUndefined();
  });
});
