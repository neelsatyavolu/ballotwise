import { describe, expect, it } from "vitest";
import { readDdhqEarly } from "../lib/midterms/ddhqEarly";
import { fillNationParty, fillStateParty, type EarlyState, type EarlyStateDetail } from "../lib/midterms/earlyVote";

const parties = (dem: [number, number], rep: [number, number], none: [number, number]) => [
  { name: "Democrat", requests: 0, sent: 0, returns: dem[0], early: dem[1] },
  { name: "Republican", requests: 0, sent: 0, returns: rep[0], early: rep[1] },
  { name: "No Party", requests: 0, sent: 0, returns: none[0], early: none[1] },
];

describe("DDHQ early vote by party", () => {
  it("adds mail returns and in-person early votes, by county and statewide", () => {
    const out = readDdhqEarly("13", [
      { countyfips: "1", parties: parties([10, 5], [20, 1], [3, 0]) },
      { countyfips: "121", parties: parties([100, 50], [40, 10], [30, 0]) },
    ]);
    expect(out?.counties["13001"]).toEqual({ dem: 15, rep: 21, other: 3 });
    expect(out?.counties["13121"]).toEqual({ dem: 150, rep: 50, other: 30 });
    expect(out?.state).toEqual({ dem: 165, rep: 71, other: 33 });
  });

  it("counts towns and statewide lines toward the state but not as counties", () => {
    const out = readDdhqEarly("23", [
      { countyfips: "00100", parties: parties([5, 0], [4, 0], [1, 0]) },
      { countyfips: "0", parties: parties([1, 0], [1, 0], [0, 0]) },
    ]);
    expect(out?.counties).toEqual({});
    expect(out?.state).toEqual({ dem: 6, rep: 5, other: 1 });
  });

  it("leaves out a county with no ballots yet, so it never shows a lead", () => {
    const out = readDdhqEarly("13", [
      { countyfips: "1", parties: parties([1, 0], [0, 0], [0, 0]) },
      { countyfips: "3", parties: parties([0, 0], [0, 0], [0, 0]) },
    ]);
    expect(Object.keys(out?.counties ?? {})).toEqual(["13001"]);
  });

  it("is null when nothing has been cast, and throws on a malformed answer", () => {
    expect(readDdhqEarly("21", [])).toBeNull();
    expect(() => readDdhqEarly("21", { error: "nope" })).toThrow();
  });
});

const state = (code: string, party: EarlyState["party"]): EarlyState => ({
  state: code,
  requested: 0,
  returned: 10,
  inperson: 0,
  cast: 10,
  party,
  base2024: null,
  partyFrom: party ? "registration" : null,
});

describe("filling the party from DDHQ", () => {
  const split = { dem: 6, rep: 4, other: 1 };
  const ddhq = { state: split, counties: { "13121": { dem: 3, rep: 1, other: 0 } } };

  it("fills only states civicAPI has no party for", () => {
    const own = { dem: 1, rep: 9, other: 0 };
    const out = fillNationParty([state("PA", own), state("GA", null), state("TX", null)], { GA: ddhq, TX: null });
    expect(out.map((s) => [s.state, s.party, s.partyFrom])).toEqual([
      ["PA", own, "registration"],
      ["GA", split, "ddhq"],
      ["TX", null, null],
    ]);
  });

  it("fills a state's counties by FIPS code", () => {
    const detail = {
      ...state("GA", null),
      fetchedAt: 0,
      asOf: null,
      byTown: false,
      prior: null,
      demographics: {},
      lean: null,
      counties: [
        { name: "Fulton", fips: "13121", base2024: null, requested: 0, returned: 4, inperson: 0, cast: 4, party: null },
        { name: "Elsewhere", fips: null, base2024: null, requested: 0, returned: 1, inperson: 0, cast: 1, party: null },
      ],
    } satisfies EarlyStateDetail;
    const out = fillStateParty(detail, ddhq);
    expect(out.partyFrom).toBe("ddhq");
    expect(out.party).toEqual(split);
    expect(out.counties.map((c) => c.party)).toEqual([{ dem: 3, rep: 1, other: 0 }, null]);
    expect(fillStateParty(detail, null)).toBe(detail);
  });
});
