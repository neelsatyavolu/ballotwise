import { describe, expect, it } from "vitest";
import { ddhqRace, raceRecords } from "../lib/ddhq/elections";
import { pickDdhq } from "../lib/midterms/local";

// Shaped as DDHQ's county page carried its races on Nov 3 2026 (RSC text with escaped JSON around them).
const rec = (id: number, name: string, office: string, district: string, votes: number[], expected = 0) => ({
  race_date: "2026-11-03 EST", name, year: 2026, state: "California", stateAbb: "CA", stateFips: "06", office, officeId: "25", district,
  electionType: name, id, slug: `2026-11-03/california-race-${id}`,
  turnout: { estimated_votes_mid: expected, precincts_in: 10, precincts_tot: 100 },
  toplineResults: votes.map((v, i) => ({ candId: i + 1, firstName: name === "Ballot Question" ? "" : `First${i}`, lastName: name === "Ballot Question" ? (i ? "No" : "Yes") : `Last${i}`, votes: v, percent: 0, winner: false, party: { name: "Nonpartisan" }, color: "#008F5D" })),
  totalVotes: votes.reduce((a, b) => a + b, 0),
});
const page = (records: object[]) => `5:["$","$L4",null,{"races":[${records.map((r) => JSON.stringify(r)).join(",")}]}]\n`;
const districts = { state: "California", county: "Santa Clara County", place: "Palo Alto city", congressional: null, stateSenate: null, stateHouse: null, schoolDistrict: "Palo Alto Unified School District", highSchoolDistrict: null };

describe("DDHQ county pages", () => {
  it("reads each race once, with DDHQ's expected vote as its share counted", () => {
    const text = page([rec(816321, "Ballot Question", "Palo Alto Measure J", "", [6000, 4000], 40_000), rec(816321, "Ballot Question", "Palo Alto Measure J", "", [6000, 4000])]);
    const races = raceRecords(text).map(ddhqRace);
    expect(races).toHaveLength(1);
    expect(races[0]).toMatchObject({ id: 200_816_321, title: "Palo Alto Measure J", total: 10_000, reporting: 25, expected: 40_000, local: { kind: "question" } });
    expect(races[0].candidates.map((c) => c.name)).toEqual(["Yes", "No"]);
    // Without an expected vote, the share of precincts in.
    expect(ddhqRace(raceRecords(page([rec(1, "General Election", "Los Altos City Council", "2", [5, 3])]))[0])).toMatchObject({ reporting: 10, title: "Los Altos City Council, District 2" });
  });

  it("picks the address's city, school district and county races, district seats as nearby, and the state's measures", () => {
    const races = raceRecords(page([
      rec(1, "Ballot Question", "Palo Alto Measure J", "", [1, 1]),
      rec(2, "General Election", "Palo Alto City Council", "", [1, 1]),
      rec(3, "General Election", "Palo Alto Unified School District school board Trustee Area 2", "", [1, 1]),
      rec(4, "General Election", "Los Altos City Council", "2", [1, 1]),
      rec(9, "General Election", "Palo Alto City Council", "At-Large", [1, 1]),
      rec(5, "Ballot Question", "Mountain View-Los Altos Union High School District Measure E", "", [1, 1]),
      rec(6, "Ballot Question", "Santa Clara County Measure A", "", [1, 1]),
      rec(7, "General Election", "Santa Clara City Council", "3", [1, 1]),
      rec(8, "Ballot Question", "Proposition 1 - Veteran and Housing Assistance Programs Bond Measure", "", [1, 1]),
    ])).map(ddhqRace);
    const picked = pickDdhq(races, districts, "CA", "Palo Alto");
    // An at-large seat is the whole city's; its name drops "District At-Large" (it shares the plain race's name here).
    expect(picked.yours.map((r) => r.title)).toEqual(["Palo Alto Measure J", "Palo Alto City Council", "Palo Alto City Council", "Santa Clara County Measure A"]);
    expect(picked.nearby.map((r) => r.title)).toEqual(["Palo Alto Unified School District school board Trustee Area 2"]);
    expect(picked.measures?.map((r) => r.title)).toEqual(["Proposition 1 - Veteran and Housing Assistance Programs Bond Measure"]);
  });
});
