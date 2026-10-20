import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signUp } from "../lib/auth/accounts";
import { applyAction, chatTurn, createDashboard, listDashboards, MAX_DASHBOARDS, racesPrompt, renameDashboard, sanitizeLayout } from "../lib/midterms/dashboard";
import { addFavorite, listFavorites, removeFavorite } from "../lib/midterms/favorites";
import { balance, raceDetail, summarize, type RaceSummary } from "../lib/midterms/races";
import { fetchCatalog, resetCivicMemo } from "../lib/midterms/civic";
import { raceLabel } from "../lib/midterms/view";
import { testDb } from "./sqlite-db";

const NOW = 1_800_000_000_000; // 2027, after the polls opened
const BEFORE_POLLS = Date.parse("2026-10-20T00:00:00Z");
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

const raw = (over: Record<string, unknown>) => ({
  id: 1,
  type: "US Senate",
  country: "US",
  province: "PA",
  district: null,
  municipality: null,
  election_name: "Pennsylvania US Senate",
  election_type: "Statewide",
  election_date: "2026-11-03T05:00:00.000Z",
  has_breakdown: true,
  has_map: true,
  percent_reporting: 40,
  candidates: [
    { name: "Ann Lee", party: "Republican", votes: 300, percent: 0, winner: false },
    { name: "Bo Diaz", party: "Democratic", votes: 700, percent: 0, winner: true },
  ],
  ...over,
});

describe("summarize", () => {
  it("classifies the four offices and skips primaries, runoffs, other dates, and the national composite", () => {
    expect(summarize(raw({}), [])?.office).toBe("senate");
    expect(summarize(raw({ type: "House of Representatives", election_name: "Pennsylvania US House 5", district: "PA-05" }), [])).toMatchObject({ office: "house", district: 5 });
    expect(summarize(raw({ type: "House of Representatives", election_name: "Wyoming US House At-Large", district: "WY-AL", province: "WY" }), [])).toMatchObject({ office: "house", district: 0 });
    expect(summarize(raw({ type: "Governor", election_name: "Pennsylvania Governor" }), [])?.office).toBe("governor");
    expect(summarize(raw({ type: "Referendum", election_name: "Missouri Amendment 8" }), [])?.office).toBe("measure");
    expect(summarize(raw({ type: "Referendum", election_type: "Local" }), [])).toBeNull();
    expect(summarize(raw({ election_name: "Pennsylvania US Senate Republican Primary" }), [])).toBeNull();
    expect(summarize(raw({ election_name: "Georgia US House 13 Runoff", type: "House of Representatives" }), [])).toBeNull();
    expect(summarize(raw({ election_date: "2026-06-02T05:00:00.000Z" }), [])).toBeNull();
    expect(summarize(raw({ province: "US", election_name: "United States Senate" }), [])).toBeNull();
    expect(summarize(raw({ type: "State House" }), [])).toBeNull();
  });

  it("orders candidates by votes, computes shares, and carries the source's call", () => {
    const race = summarize(raw({}), [])!;
    expect(race.candidates.map((c) => [c.name, c.pct, c.winner])).toEqual([["Bo Diaz", 70, true], ["Ann Lee", 30, false]]);
    expect(race.total).toBe(1000);
    expect(race.reporting).toBe(40);
  });

  it("ignores a winner flag before any votes are counted unless the candidate is unopposed", () => {
    const early = [
      { name: "Ann Lee", party: "Republican", votes: 0, percent: 0, winner: true },
      { name: "Bo Diaz", party: "Democratic", votes: 0, percent: 0, winner: false },
    ];
    expect(summarize(raw({ candidates: early }), [])!.candidates.some((c) => c.winner)).toBe(false);
    expect(summarize(raw({ candidates: [early[0]] }), [])!.candidates[0].winner).toBe(true);
  });

  it("lists major-party candidates, then independents, then write-ins before votes arrive", () => {
    const cands = ["Write-In", "Libertarian", "Independent", "Republican"].map((party, i) => ({ name: `C${i}  X`, party, votes: 0, percent: 0, winner: false }));
    expect(summarize(raw({ candidates: cands }), [])!.candidates.map((c) => c.party)).toEqual(["Republican", "Independent", "Libertarian", "Write-In"]);
    expect(summarize(raw({ candidates: cands }), [])!.candidates[0].name).toBe("C3 X");
  });

  it("attaches the race rating by office, state and district", () => {
    const ratings = [{ office: "house" as const, state: "PA", district: 7, rating: "tossup" as const }];
    expect(summarize(raw({ type: "House of Representatives", election_name: "Pennsylvania US House 7", district: "PA-07" }), ratings)?.rating).toBe("tossup");
    expect(summarize(raw({ type: "House of Representatives", election_name: "Pennsylvania US House 8", district: "PA-08" }), ratings)?.rating).toBeNull();
  });

  it("describes ballot measures from Ballotpedia, or from the name's own description", () => {
    const sheriffs = summarize(raw({ type: "Referendum", province: "MO", election_name: "Missouri Amendment 8" }), [])!;
    expect(sheriffs.about).toEqual({ text: "Require the election of county sheriffs", url: expect.stringContaining("ballotpedia.org/Missouri_Amendment_8") });
    const unknown = summarize(raw({ type: "Proposition", province: "ZZ", election_name: "Nowhere Proposition 9 - Rename the state bird" }), [])!;
    expect(unknown.about).toEqual({ text: "Rename the state bird", url: null });
    expect(raceLabel({ ...unknown, state: "AZ", title: "Arizona Proposition 142 - Prohibit DEI Preferences" })).toBe("Proposition 142");
    expect(summarize(raw({ type: "Referendum", election_name: "Nowhere Amendment 1" }), [])!.about).toBeUndefined();
    expect(summarize(raw({}), [])!.about).toBeUndefined();
  });
});

describe("raceDetail", () => {
  it("turns region results into counties with their 2024 margin", () => {
    const summary = summarize(raw({ id: 87000, type: "House of Representatives", election_name: "Pennsylvania US House 5", district: "PA-05" }), [])!;
    const detail = raceDetail(summary, fixture("civic-race-pa05.json"), { "42029": 14.5 });
    expect(detail.office).toBe("house");
    expect(detail.district).toBe(5);
    const chester = detail.counties.find((c) => c.name === "Chester")!;
    expect(chester.fips).toBe("42029");
    expect(chester.baseline2024).toBe(14.5);
    expect(detail.counties.length).toBeGreaterThan(0);
    expect(detail.pollsClose).toMatch(/^2026-11-0/);
    expect(detail.candidates.map((c) => c.name)).toContain("Mary Gay Scanlon");
  });

  it("keeps town-level regions without a FIPS code", () => {
    const detail = raceDetail(summarize(raw({}), [])!, { ...raw({}), region_results: { abbot: { name: "Abbot", type: "Township", percent_reporting: 0, candidates: [] } } }, {});
    expect(detail.counties[0]).toMatchObject({ name: "Abbot", fips: null, baseline2024: null });
  });
});

describe("balance", () => {
  const won = (office: RaceSummary["office"], party: string) => summarize(raw({ type: office === "house" ? "House of Representatives" : "US Senate", election_name: office === "house" ? "X US House 1" : "X US Senate", district: "PA-01", candidates: [{ name: "A", party, votes: 1, percent: 100, winner: true }] }), [])!;

  it("adds Senate seats not up this year and counts independents apart", () => {
    const b = balance([won("senate", "Democratic"), won("senate", "Republican"), won("senate", "Independent")]);
    expect(b.senate).toMatchObject({ D: 35, R: 32, other: 1, total: 100 });
    expect(b.house).toMatchObject({ D: 0, R: 0, total: 435, majority: 218 });
  });
});

describe("fetchCatalog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetCivicMemo();
  });

  it("pages through each race type and keeps only Nov 3 general races", async () => {
    const gov = fixture("civic-search-governor.json");
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      const races = url.includes("type=Governor") ? gov.races : [];
      return new Response(JSON.stringify({ count: races.length, offset: 0, limit: 500, races }));
    });
    const { races, stale } = await fetchCatalog(NOW);
    expect(stale).toBe(false);
    expect(races.length).toBeGreaterThan(5);
    expect(races.every((r) => r.office === "governor")).toBe(true);
    expect(calls.some((u) => u.includes("type=House%20of%20Representatives"))).toBe(true);
  });

  it("shows no votes or calls before the polls open, since civicAPI has shown test counts", async () => {
    const counted = { ...raw({ id: 7, type: "Governor", election_name: "Pennsylvania Governor" }) };
    vi.stubGlobal("fetch", async (url: string) => new Response(JSON.stringify({ races: url.includes("type=Governor") ? [counted] : [] })));
    const { races } = await fetchCatalog(BEFORE_POLLS);
    expect(races[0]).toMatchObject({ reporting: 0, total: 0 });
    expect(races[0].candidates.every((c) => c.votes === 0 && !c.winner)).toBe(true);
  });

  it("serves the last good catalog, marked stale, when civicAPI fails", async () => {
    const gov = fixture("civic-search-governor.json");
    vi.stubGlobal("fetch", async (url: string) => new Response(JSON.stringify({ races: url.includes("type=Governor") ? gov.races : [] })));
    const first = await fetchCatalog(NOW);
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    const second = await fetchCatalog(NOW + 120_000);
    expect(second.stale).toBe(true);
    expect(second.races.length).toBe(first.races.length);
  });
});

describe("favorites", () => {
  it("adds, lists newest first, ignores duplicates, and removes", async () => {
    const db = testDb();
    const { user } = await signUp(db, "fan@example.com", "a long password", NOW);
    await addFavorite(db, user.id, 5, NOW);
    await addFavorite(db, user.id, 9, NOW + 1);
    await addFavorite(db, user.id, 5, NOW + 2);
    expect(await listFavorites(db, user.id)).toEqual([9, 5]);
    await removeFavorite(db, user.id, 9);
    expect(await listFavorites(db, user.id)).toEqual([5]);
  });
});

describe("AI dashboards", () => {
  const races = [summarize(raw({ id: 10 }), [])!, summarize(raw({ id: 11, type: "Governor", election_name: "Ohio Governor", province: "OH" }), [])!];
  const layout = (title: string, raceIds: number[]) => ({ title, sections: [{ title: "S", note: "", raceIds }] });

  it("lists every race compactly for the model, with the leader once votes are in", () => {
    const prompt = racesPrompt(races);
    expect(prompt).toContain("10|senate|PA|||Bo Diaz 70%|40|");
    expect(prompt).toContain("11|governor|OH");
  });

  it("drops race ids the catalog doesn't have, duplicates, and empty sections", () => {
    const clean = sanitizeLayout({ title: "Mine", sections: [{ title: "A", note: "", raceIds: [10, 999, 10] }, { title: "Empty", note: "", raceIds: [404] }] }, races);
    expect(clean.sections).toEqual([{ title: "A", note: "", raceIds: [10] }]);
  });

  it("creates, updates, renames and deletes through chat actions, only on the voter's own dashboards", async () => {
    const db = testDb();
    const { user } = await signUp(db, "ai@example.com", "a long password", NOW);
    const { user: other } = await signUp(db, "other@example.com", "a long password", NOW);
    const id = await applyAction(db, user.id, { type: "create", layout: layout("Close", [10, 999]) }, races, null, NOW);
    expect(await listDashboards(db, user.id)).toMatchObject([{ id, layout: layout("Close", [10]) }]);

    expect(await applyAction(db, user.id, { type: "update", dashboardId: id!, layout: layout("Close", [10, 11]) }, races, id, NOW + 1)).toBe(id);
    expect((await listDashboards(db, user.id))[0].layout.sections[0].raceIds).toEqual([10, 11]);

    // Another voter can't touch it, even by naming its id.
    await applyAction(db, other.id, { type: "delete", dashboardId: id! }, races, null, NOW + 2);
    await applyAction(db, other.id, { type: "update", dashboardId: id!, layout: layout("Hijack", []) }, races, null, NOW + 2);
    expect((await listDashboards(db, user.id))[0].layout.title).toBe("Close");

    expect(await renameDashboard(db, user.id, id!, "Nail-biters", NOW + 3)).toBe(true);
    expect((await listDashboards(db, user.id))[0].layout.title).toBe("Nail-biters");

    expect(await applyAction(db, user.id, { type: "delete", dashboardId: id! }, races, id, NOW + 4)).toBeNull();
    expect(await listDashboards(db, user.id)).toEqual([]);
  });

  it("sends Grok the races, dashboards and conversation, and reads back its reply and action", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      const text = JSON.stringify({ reply: "Added Ohio.", action: { type: "update", dashboardId: "d1", layout: layout("Close", [10, 11]) } });
      const done = { type: "response.completed", response: { output: [{ type: "message", content: [{ text }] }] } };
      return new Response(`data: ${JSON.stringify(done)}\n\n`, { headers: { "content-type": "text/event-stream" } });
    });
    const turn = await chatTurn({ accessToken: "t", refreshToken: "r", expiresAt: NOW * 2 } as never, races, [{ id: "d1", layout: layout("Close", [10]), updatedAt: NOW }], "d1", [{ role: "user", content: "add Ohio governor" }]);
    vi.unstubAllGlobals();
    expect(turn).toMatchObject({ reply: "Added Ohio.", action: { type: "update", dashboardId: "d1" } });
    // Grok's model lookup goes first; the prompt is in the request that has an input.
    const sent = bodies.find((b) => b.includes('"input"')) ?? "";
    expect(sent).toContain("11|governor|OH");
    expect(sent).toContain("Open dashboard: d1");
    expect(sent).toContain("add Ohio governor");
  });

  it("refuses a chat update to a dashboard renamed while Grok was working", async () => {
    const db = testDb();
    const { user } = await signUp(db, "race@example.com", "a long password", NOW);
    const id = await createDashboard(db, user.id, layout("Close", [10]), NOW);
    const seen = await listDashboards(db, user.id);
    await renameDashboard(db, user.id, id, "Renamed", NOW + 1);
    await expect(applyAction(db, user.id, { type: "update", dashboardId: id, layout: layout("Close", [10, 11]) }, races, id, NOW + 2, seen)).rejects.toThrow(/changed while Grok/);
    expect((await listDashboards(db, user.id))[0].layout.title).toBe("Renamed");
  });

  it("refuses to create more than the limit", async () => {
    const db = testDb();
    const { user } = await signUp(db, "many@example.com", "a long password", NOW);
    for (let i = 0; i < MAX_DASHBOARDS; i++) await createDashboard(db, user.id, layout(`D${i}`, [10]), NOW + i);
    await expect(applyAction(db, user.id, { type: "create", layout: layout("One more", [10]) }, races, null, NOW)).rejects.toThrow(/up to/);
  });
});
