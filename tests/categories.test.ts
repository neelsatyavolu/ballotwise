import { describe, expect, it } from "vitest";
import { categoryOf } from "../lib/categories";
import { profilePrompt } from "../lib/prompts";
import { ballotContestsSchema, type Race } from "../lib/schema";

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
});
