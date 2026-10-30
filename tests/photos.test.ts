import { describe, expect, it } from "vitest";
import { raceKey } from "../lib/midterms/odds";
import { photoKey } from "../lib/midterms/photos";
import { candidates2026, placeholders, raceTitles } from "../scripts/ballotpedia.mjs";
import { firstInitial, lookupNames, nameParts, raceKey as buildKey, sameName, seatSurname } from "../scripts/photo-names.mjs";

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

  it("matches a seat holder whose compound surname civicAPI spells with only its last part", () => {
    expect(seatSurname(nameParts("Teresa Leger Fernández"), nameParts("Teresa Leger Fernandez"))).toBe(true);
    expect(seatSurname(nameParts("Kristen McDonald Rivet"), { firsts: ["kristen"], last: "mcdonald rivet" })).toBe(true);
    expect(seatSurname({ firsts: ["teresa"], last: "leger fernandez" }, nameParts("Teresa Fernandez"))).toBe(true);
    expect(seatSurname(nameParts("Adam Smith"), nameParts("Adam Smyth"))).toBe(false);
  });

  it("reads the first initial a person's name starts with", () => {
    expect(firstInitial("J. D. Ford")).toBe("j");
    expect(firstInitial("T.P. Nykoriak")).toBe("t");
    expect(firstInitial("“Bud” Ellis Smith")).toBe("e");
    expect(firstInitial("Élise Durand")).toBe("e");
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

describe("Ballotpedia race pages", () => {
  it("names the 2026 race page for each office", () => {
    expect(raceTitles({ office: "senate", title: "U.S. Senate" }, "Mississippi")).toEqual(["United_States_Senate_election_in_Mississippi,_2026"]);
    expect(raceTitles({ office: "senate", title: "Ohio US Senate Special General" }, "Ohio")).toEqual(["United_States_Senate_special_election_in_Ohio,_2026"]);
    expect(raceTitles({ office: "governor", title: "Governor" }, "Ohio")).toEqual(["Ohio_gubernatorial_and_lieutenant_gubernatorial_election,_2026", "Ohio_gubernatorial_election,_2026"]);
    expect(raceTitles({ office: "house", title: "", district: 4 }, "Mississippi")).toEqual(["Mississippi's_4th_Congressional_District_election,_2026"]);
    expect(raceTitles({ office: "house", title: "", district: 12 }, "New York")).toEqual(["New_York's_12th_Congressional_District_election,_2026"]);
    expect(raceTitles({ office: "house", title: "", district: 22 }, "California")).toEqual(["California's_22nd_Congressional_District_election,_2026"]);
    // States ending in "s" take a bare apostrophe.
    expect(raceTitles({ office: "house", title: "", district: 4 }, "Texas")).toEqual(["Texas'_4th_Congressional_District_election,_2026", "Texas's_4th_Congressional_District_election,_2026"]);
    expect(raceTitles({ office: "house", title: "", district: 0 }, "Alaska")).toEqual(["United_States_House_of_Representatives_election_in_Alaska,_2026"]);
  });

  const row = (image: string, name: string, page = name.replace(/ /g, "_")) =>
    `<tr class="results_row"><td></td><td><div class="image-candidate-thumbnail-wrapper"><img class="image-candidate-thumbnail" src="${image}" onerror="imgError(this);" alt="Image of ${name}" title="${name}" /></div></td><td><a href="https://ballotpedia.org/${page}" target="_blank">${name}</a> (D)</td></tr>`;

  it("reads each 2026 candidate once, with the general election's photo, and skips earlier years", () => {
    const html = `<h5 class="votebox-header-election-type">Special general election for U.S. Senate Ohio</h5><p>running on November 3, 2026.</p><table>${row("https://x/100/100/Brown.jpg", "Sherrod Brown")}${row("https://x/100/100/Pat.jpg", "Patrick O&#39;Neil", "Patrick_O%27Neil")}</table>
      <h5>Democratic primary for U.S. Senate Ohio</h5><p>on May 5, 2026.</p><table>${row("https://x/100/100/Brown-primary.jpg", "Sherrod Brown")}${row("https://x/100/100/Levy.jpg", "Greg Levy")}</table>
      <h5>General election for U.S. Senate Ohio</h5><p>November 8, 2022.</p><table>${row("https://x/old.jpg", "Tim Ryan")}</table>`;
    expect(candidates2026(html)).toEqual([
      { name: "Sherrod Brown", page: "Sherrod_Brown", image: "https://x/100/100/Brown.jpg", general: true },
      { name: "Patrick O'Neil", page: "Patrick_O'Neil", image: "https://x/100/100/Pat.jpg", general: true },
      { name: "Greg Levy", page: "Greg_Levy", image: "https://x/100/100/Levy.jpg", general: false },
    ]);
  });

  it("treats an image shown for several people as the no-photo stand-in", () => {
    const set = placeholders([
      { image: "https://x/100/100/Silhouette.png", page: "A" },
      { image: "https://y/100/100/Silhouette.png", page: "B" },
      { image: "https://x/100/100/Colom.jpeg", page: "Scott_Colom" },
      { image: "https://z/100/100/Colom.jpeg", page: "Scott_Colom" },
    ]);
    expect([...set]).toEqual(["Silhouette.png"]);
  });
});
