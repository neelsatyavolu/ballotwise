import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readPulsePage } from "../lib/ddhq/pulse";

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
    expect(readPulsePage(pages.house, "house")).toEqual({ chambers: { house: { dem: 84, rep: 16 } }, races: {} });
  });

  it("finds nothing in a page of another shape", () => {
    expect(readPulsePage('0:{"P":null}\n', "senate")).toEqual({ chambers: {}, races: {} });
    expect(readPulsePage(pages.senate, "governor").chambers).toEqual({});
  });
});
