import { afterEach, describe, expect, it, vi } from "vitest";
import { foundFrom, matchFound, pagesFor, searchDdhq, withDdhq } from "../lib/ddhq/search";
import { raceRecords } from "../lib/ddhq/elections";
import type { FoundRace } from "../lib/midterms/civic";

// Shaped as DDHQ's Los Angeles County page carried its races on Nov 3 2026.
const rec = (id: number, office: string, level: string, name = "General Election", district = "") => ({
  race_date: "2026-11-03 EST", name, year: 2026, state: "California", stateAbb: "CA", office, district, electionType: name, level, id,
  slug: `2026-11-03/california-race-${id}`, turnout: { estimated_votes_mid: 100 }, totalVotes: 10,
  toplineResults: [{ firstName: "A", lastName: "B", votes: 10, winner: false, party: { name: "Nonpartisan" } }],
});
const LA = [
  rec(1, "Mayor of Compton", "City"),
  rec(2, "Los Angeles Mayor", "City"),
  rec(3, "Governor", "Statewide"),
  rec(4, "US House", "Federal/District", "General Election", "34"),
  rec(5, "Proposition 1 - Veteran and Housing Assistance Programs Bond Measure", "State Referendum", "Ballot Question"),
  rec(6, "Supreme Court - Retain Kelli Evans", "State Referendum", "Ballot Question"),
  rec(7, "Los Angeles Unified School District Board Member", "Universal", "General Election", "3"),
  rec(8, "Attorney General", "Statewide"),
];
const page = (records: object[]) => `5:["$","$L4",null,{"races":[${records.map((r) => JSON.stringify(r)).join(",")}]}]\n`;
const found = foundFrom(raceRecords(page(LA)), { state: "CA", county: "Los Angeles" });

describe("DDHQ search", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the county or state page a query names, and none for an office alone", () => {
    expect(pagesFor("los angeles mayor")).toEqual([{ state: "CA", county: "Los Angeles" }]);
    expect(pagesFor("Travis County judge")).toEqual([{ state: "TX", county: "Travis" }]);
    expect(pagesFor("georgia state senate")).toEqual([{ state: "GA" }]);
    // A state names its own page, not its same-named county's, unless the query says county or city.
    expect(pagesFor("new york attorney general")).toEqual([{ state: "NY" }]);
    expect(pagesFor("new york city council")).toEqual([{ state: "NY", county: "New York" }]);
    expect(pagesFor("school board")).toEqual([]);
    // Santa Clara County's own feed answers for it.
    expect(pagesFor("santa clara school board")).toEqual([]);
  });

  it("leaves tracked offices out and links each race to DDHQ", () => {
    const titles = found.map((f) => f.race.title);
    expect(titles).not.toContain("Governor");
    expect(titles).not.toContain("US House, District 34");
    expect(titles.some((t) => t.startsWith("Proposition 1"))).toBe(false);
    expect(titles).toContain("Supreme Court - Retain Kelli Evans");
    const mayor = found.find((f) => f.race.title === "Los Angeles Mayor")!.race;
    expect(mayor).toMatchObject({ id: 200_000_002, state: "CA", type: "Mayor", kind: "local", date: "2026-11-03", url: "https://votes.decisiondeskhq.com/races/2026-11-03/california-race-2" });
    expect(found.find((f) => f.race.title === "Attorney General")!.race).toMatchObject({ kind: "statewide", type: "Attorney General" });
  });

  it("matches every word, the race naming the most of them in its title first", () => {
    expect(matchFound("los angeles mayor", found).map((r) => r.title)).toEqual(["Los Angeles Mayor", "Mayor of Compton"]);
    expect(matchFound("los angeles school board", found).map((r) => r.title)).toEqual(["Los Angeles Unified School District Board Member, District 3"]);
    expect(matchFound("los angeles sheriff", found)).toEqual([]);
  });

  it("answers from DDHQ's page without civicAPI", async () => {
    const fetcher = vi.fn(async () => new Response(page(LA), { headers: { "content-type": "text/x-component" } }));
    vi.stubGlobal("fetch", fetcher);
    const races = await searchDdhq("los angeles mayor", 1);
    expect(races.map((r) => r.title)).toEqual(["Los Angeles Mayor", "Mayor of Compton"]);
    expect(String((fetcher.mock.calls[0] as unknown[])[0])).toBe("https://votes.decisiondeskhq.com/elections/2026-11-03/california/los-angeles");
    // Within a minute the page is read once.
    await searchDdhq("los angeles school board", 2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps civicAPI's entry where both list a race, ahead of other dates", () => {
    const civic: FoundRace[] = [
      { id: 79938, title: "Los Angeles Mayor Open Primary", state: "CA", type: "Mayor", date: "2026-06-02", kind: "local" },
      { id: 182171, title: "Los Angeles Mayor", state: "CA", type: "Mayor", date: "2026-11-03", kind: "local" },
    ];
    const ddhq = matchFound("los angeles mayor", found);
    expect(withDdhq(ddhq, civic).map((r) => r.id)).toEqual([182171, 200_000_001, 79938]);
    expect(withDdhq(ddhq, []).map((r) => r.title)).toEqual(["Los Angeles Mayor", "Mayor of Compton"]);
  });
});
