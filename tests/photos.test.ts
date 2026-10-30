import { describe, expect, it } from "vitest";
import { raceKey } from "../lib/midterms/odds";
import { photoKey } from "../lib/midterms/photos";
import { lookupNames, nameParts, raceKey as buildKey, sameName } from "../scripts/photo-names.mjs";

describe("candidate photo names", () => {
  it("reads first names, nicknames and last names the way civicAPI spells them", () => {
    expect(nameParts("James C. “Jim” McDermott")).toEqual({ firsts: ["james", "jim"], last: "mcdermott" });
    expect(nameParts("Daniel J. Jr. Sullivan")).toEqual({ firsts: ["daniel"], last: "sullivan" });
    // An initial first name means the person goes by their middle name.
    expect(nameParts("G. Seville Hatch")).toEqual({ firsts: ["seville"], last: "hatch" });
    expect(nameParts("Monica De La Cruz").last).toBe("de la cruz");
    expect(nameParts('Joseph "Dr. Joe" Arminio').firsts).toEqual(["joseph", "joe"]);
  });

  it("matches the same person under a nickname or short form, and nobody else", () => {
    expect(sameName(nameParts("Daniel J. Jr. Sullivan"), nameParts("Dan Sullivan"))).toBe(true);
    expect(sameName(nameParts("Chris Murphy"), nameParts("Christopher Murphy"))).toBe(true);
    expect(sameName(nameParts("José Peña"), nameParts("Jose Pena"))).toBe(true);
    // Same last name, different person.
    expect(sameName(nameParts("Adam Smith"), nameParts("Jason Smith"))).toBe(false);
    // Same first name, different last name.
    expect(sameName(nameParts("Mark Kelly"), nameParts("Mark Kelley"))).toBe(false);
  });

  it("looks candidates up by their own capitalization, with nickname forms", () => {
    expect(lookupNames("James C. “Jim” McDermott")).toEqual(expect.arrayContaining(["James McDermott", "Jim McDermott"]));
    expect(lookupNames("Michael Quirk")).toContain("Mike Quirk");
  });

  it("files photos under the same race key the odds use", () => {
    for (const [office, state, district] of [["house", "CA", 22], ["house", "WY", 0], ["senate", "GA", null], ["governor", "TX", null]] as const) {
      expect(buildKey(office, state, district)).toBe(raceKey(office, state, district));
      expect(photoKey({ office, state, district }, "Jane Doe")).toBe(`${raceKey(office, state, district)}|Jane Doe`);
    }
  });
});
