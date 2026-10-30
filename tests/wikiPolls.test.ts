import { describe, expect, it } from "vitest";
import { mergePolls, pageTitle, parseWikiPolls } from "../lib/midterms/wikiPolls";

// Shaped like a Wikipedia race article: an aggregators' table, then the general election's polls.
const ARTICLE = `
==General election==
===Polling===
{| class="wikitable sortable"
!Source of poll<br>aggregation
! Dates<br />administered
! style="width:100px;" |Peggy<br />Flanagan (DFL)
! style="width:100px;" |Michele<br />Tafoya (R)
|-
|[[270toWin]]<ref>{{cite web|title=x}}</ref>
|October 1–26, 2026
|{{party shading/DFL}} |'''48.2%'''
|42.2%
|}
{| class="wikitable" style="font-size:90%;text-align:center;"
|- style="vertical-align:bottom"
! Poll source
! Date(s)<br />administered
! Sample<br />size{{efn|name="Key"}}
! Margin<br />of error
! style="width:100px;" |Peggy<br />Flanagan (DFL)
! style="width:100px;" |Michele<br />Tafoya (R)
! Other
! Undecided
|-
|style="text-align: left;"|[[New York Times]]/[[Siena University (New York)|Siena University]]<ref>{{cite web |title=Toplines}}</ref>
|October 19–26, 2026
|752 (LV)
|±{{nbsp}}4.1%
|{{party shading/DFL}}|'''54%'''
|40%
|0%
|5%
|-
|style="text-align:left;|Victory Insights (R)<ref>{{cite web|url=x}}</ref>{{efn-ua|Poll commissioned by Tafoya's campaign.}}
|September 30 – October 2, 2026
|1,194 (RV)
|{{sdash}}
| {{party shading/DFL}}|'''48%'''
|44%
|2%
|6%
|-
|colspan="8" |An undated note
|}
==Results==
`;

describe("parseWikiPolls", () => {
  const polls = parseWikiPolls(ARTICLE, "2026 Minnesota");

  it("reads each general-election poll, skipping aggregators and rows it can't line up", () => {
    expect(polls).toHaveLength(2);
    expect(polls[0]).toMatchObject({
      subject: "2026 Minnesota",
      pollster: "New York Times/Siena University",
      start_date: "2026-10-19",
      end_date: "2026-10-26",
      sample_size: 752,
      population: "lv",
      answers: [
        { choice: "Peggy Flanagan", pct: 54 },
        { choice: "Michele Tafoya", pct: 40 },
      ],
    });
  });

  it("reads field dates across months, partisan sponsors and campaign internals", () => {
    expect(polls[1]).toMatchObject({ pollster: "Victory Insights", start_date: "2026-09-30", end_date: "2026-10-02", sample_size: 1194, population: "rv", partisan: "REP", internal: true });
  });

  it("finds nothing without a general-election polling section", () => {
    expect(parseWikiPolls("==Primary==\nno polls", "2026 Minnesota")).toEqual([]);
  });
});

describe("mergePolls", () => {
  const vh = { subject: "2026 Minnesota", pollster: "The New York Times/Siena College", start_date: "2026-10-19", end_date: "2026-10-26", sample_size: 752, answers: [{ choice: "Flanagan", pct: 54 }, { choice: "Tafoya", pct: 40 }] };
  const wiki = parseWikiPolls(ARTICLE, "2026 Minnesota");

  it("keeps VoteHub's copy of a poll both list, and adds the ones only Wikipedia has", () => {
    const merged = mergePolls([vh], wiki);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toBe(vh);
    expect(merged[1].pollster).toBe("Victory Insights");
  });

  it("treats the same shares a day apart in the same race as one poll", () => {
    const shifted = { ...vh, pollster: "Siena", end_date: "2026-10-27" };
    expect(mergePolls([shifted], wiki.slice(0, 1))).toHaveLength(1);
    expect(mergePolls([{ ...shifted, subject: "2026 Iowa" }], wiki.slice(0, 1))).toHaveLength(2);
  });
});

describe("pageTitle", () => {
  it("names the race's Wikipedia article", () => {
    expect(pageTitle("senate", "MN", "Minnesota US Senate")).toBe("2026 United States Senate election in Minnesota");
    expect(pageTitle("senate", "OH", "Ohio US Senate Special Election")).toBe("2026 United States Senate special election in Ohio");
    expect(pageTitle("governor", "NV", "Nevada Governor")).toBe("2026 Nevada gubernatorial election");
  });
});
