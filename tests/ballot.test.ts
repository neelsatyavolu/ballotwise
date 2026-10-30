import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signUp } from "../lib/auth/accounts";
import { districtsFrom } from "../lib/ballot/census";
import { failJob, readableError, runJob, type Job, type JobDeps } from "../lib/ballot/jobs";
import { addContestGuides, contestGuideId, getBallot, saveBallot } from "../lib/ballot/store";
import { profileKey } from "../lib/cache";
import { storeGrokTokens } from "../lib/grok/vault";
import { claimableGuideIds, getGuide, listGuides } from "../lib/guides";
import { testDb } from "./sqlite-db";

const KEY = randomBytes(32).toString("base64");
const SRC = "https://www.example.gov/candidates";
const districts = { state: "California", county: "Los Angeles County", place: "Los Angeles city", congressional: "Congressional District 34", stateSenate: null, stateHouse: null, schoolDistrict: null };

const contests = {
  elections: [{ name: "General Election", date: "2026-11-03", contests: [
    { label: "U.S. House, District 34", query: "CA-34 general 2026", level: "federal" },
    { label: "Mayor of Los Angeles", query: "LA mayor general 2026", level: "city" },
  ] }],
};
const race = {
  kind: "race",
  race: {
    title: "Mayor of Los Angeles", election: "General", date: "2026-11-03", jurisdiction: "Los Angeles",
    office: { text: "Runs the city.", sources: [SRC] }, votingRule: null,
    candidates: [
      { id: "ann", name: "Ann", party: null, ballotDesignation: null, incumbent: true },
      { id: "bob", name: "Bob", party: null, ballotDesignation: null, incumbent: false },
    ],
    issues: ["housing", "transit", "safety"].map((id) => ({ id, title: id, question: `${id}?`, sideA: "less", sideB: "more" })),
    sources: [SRC],
  },
};
const profile = {
  summary: "A candidate.", background: [{ text: "Was a teacher.", sources: [SRC] }], record: [], funding: null, endorsements: [], website: null,
  positions: [{ issueId: "housing", stance: 1, summary: "Wants more.", quote: null, sources: [SRC] }],
};

/** Grok's streaming Responses API: one web search, then the final message. */
function sse(text: string): Response {
  const events = [
    { type: "response.output_item.done", item: { type: "web_search_call", action: { query: "q", sources: [{ url: SRC }] } } },
    { type: "response.completed", response: { output: [{ type: "message", content: [{ text }] }] } },
  ];
  return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}

function stubGrok(fail?: (prompt: string) => boolean) {
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    if (!String(url).includes("api.x.ai")) return new Response("no", { status: 404 });
    const prompt = String(init?.body);
    if (fail?.(prompt)) return new Response("busy", { status: 429 });
    if (prompt.includes("Issues to estimate")) return sse(JSON.stringify({ estimates: [] }));
    if (prompt.includes("Voter address")) return sse(JSON.stringify(contests));
    if (prompt.includes("The person searched for")) return sse(JSON.stringify(race));
    return sse(JSON.stringify(profile));
  });
}

afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const db = testDb();
  const { user } = await signUp(db, "a@example.com", "a long password", 1);
  await storeGrokTokens(db, KEY, user.id, { provider: "grok" as const, accessToken: "t", refreshToken: "r", expiresAt: Date.now() + 3_600_000 }, 1);
  await saveBallot(db, user.id, "200 N Spring St, LA", "200 N SPRING ST, LOS ANGELES, CA", districts, 1);
  const queued: Job[] = [];
  const deps: JobDeps = { db, tokenKey: KEY, enqueue: async (jobs) => void queued.push(...jobs) };
  return { db, user, deps, queued };
}

/** Runs queued jobs until the queue is empty, like the Cloudflare consumer. */
async function drain(deps: JobDeps, queued: Job[]) {
  for (let job = queued.shift(); job; job = queued.shift()) await runJob(job, deps);
}

describe("districtsFrom", () => {
  it("reads year-stamped Census layer names", () => {
    expect(districtsFrom({
      States: [{ NAME: "California" }],
      "120th Congressional Districts": [{ NAME: "Congressional District 34" }],
      "2026 State Legislative Districts - Lower": [{ NAME: "Assembly District 54" }],
    })).toMatchObject({ state: "California", congressional: "Congressional District 34", stateHouse: "Assembly District 54", county: null });
    expect(districtsFrom({})).toBeNull();
  });

  it("keeps a high school district alongside an elementary one", () => {
    expect(districtsFrom({
      States: [{ NAME: "California" }],
      "Elementary School Districts": [{ NAME: "Mountain View Whisman Elementary School District" }],
      "Secondary School Districts": [{ NAME: "Mountain View-Los Altos Union School District" }],
    })).toMatchObject({ schoolDistrict: "Mountain View Whisman Elementary School District", highSchoolDistrict: "Mountain View-Los Altos Union School District" });
  });
});

describe("contest guides", () => {
  it("adds each contest once, even when contests are found again", async () => {
    const { db, user } = await setup();
    expect(await addContestGuides(db, user.id, contests as never, 1)).toHaveLength(2);
    expect(await addContestGuides(db, user.id, contests as never, 2)).toHaveLength(0);
    expect(contestGuideId(user.id, "2026-11-03", " Mayor of  Los Angeles")).toBe(contestGuideId(user.id, "2026-11-03", "mayor of los angeles"));
  });

  it("records each contest's level and kind, and fills them in for guides found before they were recorded", async () => {
    const { db, user } = await setup();
    const withMeasure = {
      elections: [{ ...contests.elections[0], contests: [...contests.elections[0].contests, { label: "Proposition 1", query: "CA prop 1 2026", level: "state", kind: "measure" }] }],
    };
    await addContestGuides(db, user.id, contests as never, 1);
    const mayor = contestGuideId(user.id, "2026-11-03", "Mayor of Los Angeles");
    await db.prepare("UPDATE guides SET level = NULL WHERE id = ?").bind(mayor).run();
    expect(await addContestGuides(db, user.id, withMeasure as never, 2)).toHaveLength(1);
    const byTitle = Object.fromEntries((await listGuides(db, user.id, "ballot")).map((g) => [g.title, [g.kind, g.level]]));
    expect(byTitle).toEqual({
      "U.S. House, District 34": ["office", "federal"],
      "Mayor of Los Angeles": ["office", "city"],
      "Proposition 1": ["measure", "state"],
    });
  });

  it("reuses a guide whose researched title matches a contest found under a different label", async () => {
    const { db, user } = await setup();
    const old = { elections: [{ name: "California General Election", date: "2026-11-03", contests: [{ label: "Board of Equalization, District 2", query: "BOE 2", level: null }] }] };
    await addContestGuides(db, user.id, old as never, 1);
    const id = contestGuideId(user.id, "2026-11-03", "Board of Equalization, District 2");
    await db.prepare("UPDATE guides SET title = ? WHERE id = ?").bind("California State Board of Equalization District 2", id).run();

    const again = { elections: [{ name: "General Election", date: "2026-11-03", contests: [{ label: "California State Board of Equalization  District 2", query: "BOE 2", level: "state" }] }] };
    expect(await addContestGuides(db, user.id, again as never, 2)).toHaveLength(0);
    const guides = await listGuides(db, user.id, "ballot");
    expect(guides.map((g) => [g.id, g.level])).toEqual([[id, "state"]]);
  });
});

describe("background research", () => {
  it("finds contests, researches each race and candidate, and marks guides ready", async () => {
    stubGrok();
    const { db, user, deps, queued } = await setup();
    queued.push({ type: "ballot", userId: user.id });
    await drain(deps, queued);

    expect((await getBallot(db, user.id))?.status).toBe("ready");
    const guides = await listGuides(db, user.id, "ballot");
    expect(guides).toHaveLength(2);
    expect(guides.every((g) => g.status === "ready")).toBe(true);
    const guide = await getGuide(db, user.id, guides[0].id);
    expect(Object.keys(guide!.data!.profiles).sort()).toEqual(["ann", "bob"]);
    expect(guide!.data!.profiles.ann.positions.map((p) => p.issueId)).toEqual(["housing", "transit", "safety"]);
  });

  it("reuses another voter's race and candidate research and offers their contests to Grok", async () => {
    stubGrok();
    const { db, user, deps, queued } = await setup();
    queued.push({ type: "ballot", userId: user.id });
    await drain(deps, queued);

    const { user: second } = await signUp(db, "b@example.com", "a long password", 1);
    await storeGrokTokens(db, KEY, second.id, { provider: "grok" as const, accessToken: "t", refreshToken: "r", expiresAt: Date.now() + 3_600_000 }, 1);
    await saveBallot(db, second.id, "201 N Spring St, LA", "201 N SPRING ST, LOS ANGELES, CA", districts, 1);
    const prompts: string[] = [];
    vi.stubGlobal("fetch", async (_url: string | URL, init?: RequestInit) => {
      prompts.push(String(init?.body));
      return sse(JSON.stringify(contests));
    });
    queued.push({ type: "ballot", userId: second.id });
    await drain(deps, queued);

    // Only the contest search went to Grok, and it was told which contests this county already has.
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("CA-34 general 2026");
    const guides = await listGuides(db, second.id, "ballot");
    expect(guides.every((g) => g.status === "ready")).toBe(true);
    const guide = await getGuide(db, second.id, guides[0].id);
    expect(Object.keys(guide!.data!.profiles).sort()).toEqual(["ann", "bob"]);
  });

  it("researches every candidate again when any one's shared profile is missing, so opponents are compared at the same time", async () => {
    stubGrok();
    const { db, user, deps, queued } = await setup();
    queued.push({ type: "ballot", userId: user.id });
    await drain(deps, queued);
    const saved = (await getGuide(db, user.id, (await listGuides(db, user.id, "ballot"))[0].id))!.data!.race;
    const bob = profileKey(saved, saved.candidates.find((c) => c.id === "bob")!);
    await db.prepare("DELETE FROM research_cache WHERE key = ?").bind(bob).run();

    const { user: second } = await signUp(db, "b@example.com", "a long password", 1);
    await storeGrokTokens(db, KEY, second.id, { provider: "grok" as const, accessToken: "t", refreshToken: "r", expiresAt: Date.now() + 3_600_000 }, 1);
    await saveBallot(db, second.id, "201 N Spring St, LA", "201 N SPRING ST, LOS ANGELES, CA", districts, 1);
    const candidates: string[] = [];
    vi.stubGlobal("fetch", async (_url: string | URL, init?: RequestInit) => {
      const prompt = String(init?.body);
      const name = /Candidate: (\w+)/.exec(prompt)?.[1];
      if (name && !prompt.includes("Issues to estimate")) candidates.push(name);
      if (prompt.includes("Voter address")) return sse(JSON.stringify(contests));
      return sse(JSON.stringify(profile));
    });
    queued.push({ type: "ballot", userId: second.id });
    await drain(deps, queued);

    // Ann is researched again with Bob rather than pairing a fresh Bob with a cached Ann. The second
    // contest shares the same race and then finds both profiles cached.
    expect(candidates.sort()).toEqual(["Ann", "Bob"]);
  });

  it("drops the interview mapping when a race is researched again, since its issues may be worded or oriented differently", async () => {
    stubGrok();
    const { db, user, deps, queued } = await setup();
    queued.push({ type: "ballot", userId: user.id });
    await drain(deps, queued);
    const [guide] = await listGuides(db, user.id, "ballot");
    await db.prepare("UPDATE guides SET suggested = ?, align_requested = 5 WHERE id = ?").bind(JSON.stringify({ housing: { stance: 2, weight: 3, why: "old" } }), guide.id).run();

    queued.push({ type: "race", guideId: guide.id });
    await drain(deps, queued);

    const row = await db.prepare("SELECT suggested, align_requested AS claim FROM guides WHERE id = ?").bind(guide.id).first<{ suggested: string | null; claim: number }>();
    expect(row).toEqual({ suggested: null, claim: 0 });
  });

  it("estimates stances that have no source, from the candidate's other positions", async () => {
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      const prompt = String(init?.body);
      if (prompt.includes("Issues to estimate")) {
        return sse(JSON.stringify({ estimates: [{ issueId: "transit", stance: 2, basis: "Based on wanting more housing." }, { issueId: "safety", stance: null, basis: "Nothing on safety." }] }));
      }
      if (prompt.includes("Voter address")) return sse(JSON.stringify(contests));
      if (prompt.includes("The person searched for")) return sse(JSON.stringify(race));
      return sse(JSON.stringify(profile));
    });
    const { db, user, deps, queued } = await setup();
    queued.push({ type: "ballot", userId: user.id });
    await drain(deps, queued);
    const [first] = await listGuides(db, user.id, "ballot");
    const positions = (await getGuide(db, user.id, first.id))!.data!.profiles.ann.positions;
    expect(positions.find((p) => p.issueId === "transit")).toMatchObject({ stance: null, estimate: { stance: 2 } });
    expect(positions.find((p) => p.issueId === "safety")?.estimate).toBeNull();
    expect(positions.find((p) => p.issueId === "housing")?.estimate).toBeUndefined();
  });

  it("records a candidate that gave up and still shows the others", async () => {
    stubGrok((prompt) => prompt.includes("Candidate: Bob"));
    const { db, user, deps, queued } = await setup();
    queued.push({ type: "ballot", userId: user.id });
    for (let job = queued.shift(); job; job = queued.shift()) {
      try {
        await runJob(job, deps);
      } catch (err) {
        await failJob(job, (err as Error).message, deps);
      }
    }
    const [first] = await listGuides(db, user.id, "ballot");
    const guide = await getGuide(db, user.id, first.id);
    expect(guide?.status).toBe("ready");
    expect(Object.keys(guide!.data!.profiles)).toEqual(["ann"]);
    expect(guide?.failedCandidates.bob).toMatch(/usage limit/);
  });

  it("fails permanently when Grok isn't connected", async () => {
    stubGrok();
    const { db, user, deps } = await setup();
    await db.prepare("DELETE FROM grok_connections").run();
    await expect(runJob({ type: "ballot", userId: user.id }, deps)).rejects.toThrow(/Grok isn't connected/);
  });

  it("researches a judge's record without issues and never matches it to the interview", async () => {
    const judgeContests = { elections: [{ name: "General Election", date: "2026-11-03", contests: [
      { label: "California Supreme Court: Kelli Evans retention", query: "Kelli Evans retention California November 3 2026", level: "judicial" },
    ] }] };
    // Grok lays the retention vote out like an office with issues; a judicial contest drops them anyway.
    const judgeRace = { kind: "race", race: { ...race.race, title: "California Supreme Court: Kelli Evans", candidates: [{ id: "kelli-evans", name: "Kelli Evans", party: null, ballotDesignation: null, incumbent: true }] } };
    const judgeProfile = { ...profile, positions: [], evaluations: [{ text: "Rated well qualified.", sources: [SRC] }] };
    const prompts: string[] = [];
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      if (!String(url).includes("api.x.ai")) return new Response("no", { status: 404 });
      const prompt = String(init?.body);
      prompts.push(prompt);
      if (prompt.includes("Voter address")) return sse(JSON.stringify(judgeContests));
      if (prompt.includes("The person searched for")) return sse(JSON.stringify(judgeRace));
      return sse(JSON.stringify(judgeProfile));
    });
    const { saveValues } = await import("../lib/values");
    const { db, user, deps, queued } = await setup();
    await saveValues(db, user.id, [], { overview: "o", priorities: [], dealbreakers: [], leadership: null } as never, 1);
    queued.push({ type: "ballot", userId: user.id });
    await drain(deps, queued);

    const [summary] = await listGuides(db, user.id, "ballot");
    expect(summary).toMatchObject({ status: "ready", kind: "judicial", match: null, fromInterview: true });
    const guide = await getGuide(db, user.id, summary.id);
    expect(guide!.data!.race).toMatchObject({ kind: "judicial", issues: [] });
    expect(guide!.data!.profiles["kelli-evans"].evaluations).toEqual([{ text: "Rated well qualified.", sources: [SRC] }]);
    expect(prompts.some((p) => p.includes("Voter's interview summary"))).toBe(false);
  });

  it("looks for judges alone on a ballot found before judges were covered, leaving its other races as they are", async () => {
    const found = { elections: [{ name: "General Election", date: "2026-11-03", contests: [
      { label: "Mayor of Los Angeles", query: "LA mayor general 2026", level: "city" },
      { label: "California Supreme Court: Kelli Evans retention", query: "Kelli Evans retention 2026", level: "judicial" },
    ] }] };
    const prompts: string[] = [];
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      if (!String(url).includes("api.x.ai")) return new Response("no", { status: 404 });
      prompts.push(String(init?.body));
      return sse(JSON.stringify(found));
    });
    const { db, user, deps, queued } = await setup();
    // A ballot from before this change: its races are in, judges were never looked for.
    await addContestGuides(db, user.id, contests as never, 1);
    await db.prepare("UPDATE ballots SET status = 'ready', judges_checked = 0").run();
    expect((await getBallot(db, user.id))?.judgesChecked).toBe(false);

    await runJob({ type: "ballot", userId: user.id, only: "judges" }, deps);

    expect(prompts[0]).toMatch(/only the judges/i);
    const guides = await listGuides(db, user.id, "ballot");
    expect(guides.map((g) => g.title).sort()).toEqual(["California Supreme Court: Kelli Evans retention", "Mayor of Los Angeles", "U.S. House, District 34"]);
    expect(queued).toEqual([{ type: "race", guideId: guides.find((g) => g.level === "judicial")!.id }]);
    expect(await getBallot(db, user.id)).toMatchObject({ status: "ready", judgesChecked: true });
  });

  it("counts a new ballot as already covering judges", async () => {
    const { db, user } = await setup();
    expect((await getBallot(db, user.id))?.judgesChecked).toBe(true);
  });
});

describe("values interview", () => {
  const summary = { overview: "You want lower rents.", priorities: [{ topic: "Housing", weight: 3, view: "Build more homes", quote: "build, build, build" }], dealbreakers: [], leadership: null };

  function stubInterview() {
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      if (!String(url).includes("api.x.ai")) return new Response("no", { status: 404 });
      const body = String(init?.body);
      if (body.includes("Voter's interview summary")) {
        // The mapping prompt must not contain candidates.
        if (body.includes("Ann")) throw new Error("candidates leaked into the mapping prompt");
        return sse(JSON.stringify({ answers: [{ issueId: "housing", stance: 2, weight: 3, why: "You said build, build, build." }, { issueId: "made-up", stance: 1, weight: 1, why: "x" }] }));
      }
      if (body.includes("end the interview now")) return sse(JSON.stringify({ done: true, summary }));
      return sse(JSON.stringify({ done: false, message: "What matters most to you?", suggestions: ["Costs", "Safety"], progress: 0.1 }));
    });
  }

  it("asks a question, then summarizes when asked to finish", async () => {
    stubInterview();
    const { nextTurn } = await import("../lib/values");
    const tokens = { provider: "grok" as const, accessToken: "t", refreshToken: "r", expiresAt: Date.now() + 3_600_000 };
    expect(await nextTurn(tokens, [], false)).toMatchObject({ role: "interviewer", suggestions: ["Costs", "Safety"] });
    expect(await nextTurn(tokens, [{ role: "voter", text: "rent" }], true)).toMatchObject({ overview: "You want lower rents." });
  });

  it("steers the interview toward the issues on the voter's ballot, never its candidates", async () => {
    stubGrok();
    const { db, user, deps, queued } = await setup();
    queued.push({ type: "ballot", userId: user.id });
    await drain(deps, queued);
    const { ballotTopics, nextTurn } = await import("../lib/values");
    const topics = await ballotTopics(db, user.id);
    expect(topics).toEqual([{ race: "Mayor of Los Angeles", questions: ["housing?", "transit?", "safety?"] }]);

    const prompts: string[] = [];
    vi.stubGlobal("fetch", async (_url: string | URL, init?: RequestInit) => {
      prompts.push(String(init?.body));
      return sse(JSON.stringify({ done: false, message: "What matters most?", suggestions: [], progress: 0.1 }));
    });
    const tokens = { provider: "grok" as const, accessToken: "t", refreshToken: "r", expiresAt: Date.now() + 3_600_000 };
    await nextTurn(tokens, [], false, topics);
    expect(prompts[0]).toContain("transit?");
    expect(prompts[0]).not.toMatch(/\bAnn\b|\bBob\b/);
  });

  it("records an issue the interview doesn't bear on as uncovered, so it isn't mapped again", async () => {
    vi.stubGlobal("fetch", async () => sse(JSON.stringify({ answers: [{ issueId: "housing", stance: null, weight: 1, why: "Nothing you said is about housing." }] })));
    const { alignToIssues } = await import("../lib/values");
    const tokens = { provider: "grok" as const, accessToken: "t", refreshToken: "r", expiresAt: Date.now() + 3_600_000 };
    const issue = { id: "housing", title: "Housing", question: "housing?", sideA: "less", sideB: "more" };
    expect(await alignToIssues(tokens, summary as never, "Mayor", [issue])).toEqual({ housing: { stance: null, weight: 1, why: "Nothing you said is about housing.", inferred: false } });
  });

  it("maps the interview onto a finished race without showing candidates, once", async () => {
    stubInterview();
    const { saveValues, claimAlignment } = await import("../lib/values");
    const { db, user, deps, queued } = await setup();
    await addContestGuides(db, user.id, contests as never, 1);
    const [first] = await listGuides(db, user.id, "ballot");
    await db.prepare("UPDATE guides SET data = ?, status = 'ready' WHERE id = ?").bind(JSON.stringify({ query: "q", race: race.race, profiles: { ann: profile }, answers: {}, overrides: {} }), first.id).run();
    await saveValues(db, user.id, [], summary as never, 1);

    expect(await claimAlignment(db, [first.id])).toEqual([first.id]);
    expect(await claimAlignment(db, [first.id])).toEqual([]);
    queued.push({ type: "align", guideId: first.id });
    await drain(deps, queued);

    const guide = await getGuide(db, user.id, first.id);
    expect(guide?.suggested).toEqual({ housing: { stance: 2, weight: 3, why: "You said build, build, build." } });
    const [summaryRow] = (await listGuides(db, user.id, "ballot")).filter((g) => g.id === first.id);
    expect(summaryRow.fromInterview).toBe(true);
    expect(summaryRow.match).toMatchObject({ picks: [{ name: "Ann", score: 75 }] });
  });

  it("does not claim alignment when research finishes before the interview", async () => {
    stubGrok();
    const { db, user, deps, queued } = await setup();
    queued.push({ type: "ballot", userId: user.id });
    await drain(deps, queued);
    // Statewide races often finish first. Claiming them before the interview exists
    // used to ack the align job and leave the card on "Matching your answers…".
    const row = await db.prepare("SELECT COALESCE(SUM(align_requested), 0) AS n FROM guides").first<{ n: number }>();
    expect(row?.n).toBe(0);
    expect(queued.filter((job) => job.type === "align")).toHaveLength(0);

    vi.unstubAllGlobals();
    stubInterview();
    const { saveValues, scheduleAlignment } = await import("../lib/values");
    await saveValues(db, user.id, [], summary as never, Date.now());
    const ids = await claimableGuideIds(db, user.id);
    expect(ids).toHaveLength(2);
    await scheduleAlignment(db, user.id, ids, async (claimed) => {
      queued.push(...claimed.map((guideId) => ({ type: "align" as const, guideId })));
    });
    await drain(deps, queued);
    const after = await listGuides(db, user.id, "ballot");
    expect(after.every((g) => g.fromInterview && g.match?.picks[0].name === "Ann" && !g.matchError)).toBe(true);
  });

  it("recovers races whose alignment was claimed before the interview existed", async () => {
    stubInterview();
    const { saveValues, scheduleAlignment } = await import("../lib/values");
    const { db, user, deps, queued } = await setup();
    await addContestGuides(db, user.id, contests as never, 1);
    const guides = await listGuides(db, user.id, "ballot");
    for (const g of guides) {
      await db.prepare("UPDATE guides SET data = ?, status = 'ready', align_requested = 1 WHERE id = ?")
        .bind(JSON.stringify({ query: "q", race: race.race, profiles: { ann: profile }, answers: {}, overrides: {} }), g.id)
        .run();
    }
    await saveValues(db, user.id, [], summary as never, Date.now());
    const ids = await claimableGuideIds(db, user.id);
    expect(ids).toHaveLength(guides.length);
    await scheduleAlignment(db, user.id, ids, async (claimed) => {
      queued.push(...claimed.map((guideId) => ({ type: "align" as const, guideId })));
    });
    expect(await scheduleAlignment(db, user.id, ids, async () => {})).toEqual([]);
    await drain(deps, queued);
    const after = await listGuides(db, user.id, "ballot");
    expect(after.every((g) => g.fromInterview && g.match?.picks[0].score === 75 && !g.matchError)).toBe(true);
  });

  it("releases a claim that runs before the interview is saved", async () => {
    const { db, user, deps } = await setup();
    await addContestGuides(db, user.id, contests as never, 1);
    const [first] = await listGuides(db, user.id, "ballot");
    await db.prepare("UPDATE guides SET data = ?, status = 'ready', align_requested = ? WHERE id = ?")
      .bind(JSON.stringify({ query: "q", race: race.race, profiles: { ann: profile }, answers: {}, overrides: {} }), Date.now(), first.id)
      .run();
    await runJob({ type: "align", guideId: first.id }, deps);
    const row = await db.prepare("SELECT align_requested AS n FROM guides WHERE id = ?").bind(first.id).first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("records an alignment failure instead of matching forever", async () => {
    vi.stubGlobal("fetch", async (url: string | URL) => {
      if (!String(url).includes("api.x.ai")) return new Response("no", { status: 404 });
      return new Response("busy", { status: 429 });
    });
    const { saveValues } = await import("../lib/values");
    const { db, user, deps } = await setup();
    await addContestGuides(db, user.id, contests as never, 1);
    const [first] = await listGuides(db, user.id, "ballot");
    await db.prepare("UPDATE guides SET data = ?, status = 'ready' WHERE id = ?")
      .bind(JSON.stringify({ query: "q", race: race.race, profiles: { ann: profile }, answers: {}, overrides: {} }), first.id)
      .run();
    await saveValues(db, user.id, [], summary as never, Date.now());
    const job = { type: "align" as const, guideId: first.id };
    await runJob(job, deps).catch(async (err) => failJob(job, readableError(err), deps));
    const [row] = (await listGuides(db, user.id, "ballot")).filter((g) => g.id === first.id);
    expect(row.fromInterview).toBe(false);
    expect(row.matchError).toMatch(/usage limit/);
    expect(await claimableGuideIds(db, user.id)).not.toContain(first.id);
  });
});
