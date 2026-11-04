import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mergeHistory, readPulsePage } from "../lib/ddhq/pulse";

// Cut from DDHQ's balance-of-power pages on Nov 3 2026 (morning): Iowa and Ohio carry a Pulse, Kansas doesn't yet.
const pages = JSON.parse(readFileSync(new URL("./fixtures/ddhq-bop.json", import.meta.url), "utf8")) as { senate: string; house: string };

describe("DDHQ Pulse", () => {
  it("reads each race's live favorite and chance, once per race, skipping races without one", () => {
    const { races } = readPulsePage(pages.senate, "senate");
    expect(races).toEqual({
      "senate:IA:": { name: "Turek", side: "D", chance: 56.36 },
      "senate:OH:": { name: "Husted", side: "R", chance: 54.48 },
    });
  });

  it("reads the chamber's chance of control", () => {
    expect(readPulsePage(pages.senate, "senate").chambers).toEqual({ senate: { dem: 65, rep: 35 } });
    expect(readPulsePage(pages.house, "house")).toMatchObject({ chambers: { house: { dem: 84, rep: 16 } }, races: {}, calls: {}, winners: {}, history: [{ at: 1793633039384, house: 84 }] });
    expect(readPulsePage(pages.senate, "senate").history).toEqual([{ at: 1793633039384, senate: 65 }]);
  });

  it("reads DDHQ's call of the chamber, when it has made one", () => {
    // As the House page carried it on Nov 3 2026: "Democrats are projected to win control of the U.S. House".
    const called = '5:{"unit":{"plural":"Seats"},"winnerParty":{"id":1,"name":"Democratic","abbrev":"DEM"},"calledAt":"2026-11-04 02:09:24.452689+00","totalSeats":435,"majorityNeeded":218,"seatCounts":[]}\n';
    expect(readPulsePage(called, "house").calls).toEqual({ house: { side: "D", at: Date.parse("2026-11-04T02:09:24.452Z") } });
    const open = '5:{"winnerParty":null,"calledAt":null,"totalSeats":100,"majorityNeeded":51}\n';
    expect(readPulsePage(open, "senate").calls).toEqual({});
    expect(readPulsePage(called.replace('"DEM"', '"GOP"'), "senate").calls).toEqual({ senate: { side: "R", at: Date.parse("2026-11-04T02:09:24.452Z") } });
  });

  it("reads each race DDHQ has called, with its winner and call time", () => {
    // As the House page carried AL-07 on Nov 3 2026.
    const page = '9:{"races":[{"raceId":294716,"displayName":"AL-07","stateAbb":"AL","district":"7","results":{"totalVotes":204074,"percentIn":81,"candidates":[{"firstName":"Terri","lastName":"Sewall","votes":139371,"winner":true,"called_at":"2026-11-04 01:00:00.135809Z","party":{"id":1,"name":"Democratic","abbrev":"DEM"}},{"firstName":"Ammie","lastName":"Akin","votes":64703,"winner":false,"called_at":null,"party":{"abbrev":"GOP"}}]}},{"raceId":294717,"stateAbb":"AL","district":"1","results":{"candidates":[{"firstName":"A","lastName":"B","winner":false,"called_at":null,"party":{"abbrev":"GOP"}}]}}]}\n';
    expect(readPulsePage(page, "house").winners).toEqual({ "house:AL:7": { name: "Terri Sewall", side: "D", at: Date.parse("2026-11-04T01:00:00.135Z") } });
    // And every seat's DDHQ race id, keyed as the DDHQ feed keys seats, called or not.
    expect(readPulsePage(page, "house").ids).toEqual({ "house:AL:7:g": 294716, "house:AL:1:g": 294717 });
    const special = '9:{"races":[{"raceId":5,"name":"Special General Election","stateAbb":"OH","district":null}]}\n';
    expect(readPulsePage(special, "senate").ids).toEqual({ "senate:OH::s": 5 });
  });

  it("reads DDHQ's own seat count, each party with the one it caucuses with", () => {
    // As the Senate page carried it on Nov 3 2026: King and Sanders (IND) sit with Democrats.
    const page = '5:{"winnerParty":null,"calledAt":null,"totalSeats":100,"majorityNeeded":51,"seatCounts":[{"id":125,"party":{"abbrev":"DEM"},"alignedWithParty":{"abbrev":"DEM"},"existingSeats":32,"seats":17,"totalSeats":49},{"id":126,"party":{"abbrev":"GOP"},"alignedWithParty":{"abbrev":"GOP"},"existingSeats":31,"seats":9,"totalSeats":40},{"id":166,"party":{"abbrev":"IND"},"alignedWithParty":{"abbrev":"DEM"},"existingSeats":2,"seats":0,"totalSeats":2},{"id":127,"party":{"abbrev":"IND"},"alignedWithParty":{"abbrev":"IND"},"totalSeats":0}]}\n';
    expect(readPulsePage(page, "senate").seats).toEqual({ senate: { D: 51, R: 40, other: 0 } });
    expect(readPulsePage(page, "governor").seats).toEqual({});
  });

  it("finds nothing in a page of another shape", () => {
    expect(readPulsePage('0:{"P":null}\n', "senate")).toEqual({ chambers: {}, races: {}, calls: {}, winners: {}, ids: {}, seats: {}, history: [] });
    expect(readPulsePage(pages.senate, "governor").chambers).toEqual({});
  });

  it("keeps the day's line in time order, dropping reads that change nothing", () => {
    const line = mergeHistory([{ at: 10, senate: 65, house: 84 }, { at: 20, senate: 65, house: 84 }], [{ at: 15, senate: 60 }, { at: 30, senate: 60, house: 80 }]);
    expect(line).toEqual([{ at: 10, senate: 65, house: 84 }, { at: 15, senate: 60 }, { at: 20, senate: 65 }, { at: 30, senate: 60, house: 80 }]);
    expect(mergeHistory([], Array.from({ length: 800 }, (_, i) => ({ at: i, senate: i % 2 })))).toHaveLength(720);
  });
});
