import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signUp } from "../lib/auth/accounts";
import { districtsFrom } from "../lib/ballot/census";
import { failJob, runJob, type Job, type JobDeps } from "../lib/ballot/jobs";
import { addContestGuides, contestGuideId, getBallot, saveBallot } from "../lib/ballot/store";
import { storeGrokTokens } from "../lib/grok/vault";
import { getGuide, listGuides } from "../lib/guides";
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
    if (prompt.includes("Voter address")) return sse(JSON.stringify(contests));
    if (prompt.includes("The person searched for")) return sse(JSON.stringify(race));
    return sse(JSON.stringify(profile));
  });
}

afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const db = testDb();
  const { user } = await signUp(db, "a@example.com", "a long password", 1);
  await storeGrokTokens(db, KEY, user.id, { accessToken: "t", refreshToken: "r", expiresAt: Date.now() + 3_600_000 }, 1);
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
});

describe("contest guides", () => {
  it("adds each contest once, even when contests are found again", async () => {
    const { db, user } = await setup();
    expect(await addContestGuides(db, user.id, contests as never, 1)).toHaveLength(2);
    expect(await addContestGuides(db, user.id, contests as never, 2)).toHaveLength(0);
    expect(contestGuideId(user.id, "2026-11-03", " Mayor of  Los Angeles")).toBe(contestGuideId(user.id, "2026-11-03", "mayor of los angeles"));
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
});
