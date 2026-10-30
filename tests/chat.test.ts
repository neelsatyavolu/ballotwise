import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { converse, MAX_ROUNDS, toolSpec, type AgentTool } from "../lib/grok/agent";
import { findRaces, raceRow } from "../lib/midterms/chatTools";
import type { RaceSummary } from "../lib/midterms/races";

const sse = (output: unknown[]) =>
  new Response(`data: ${JSON.stringify({ type: "response.completed", response: { output } })}\n\n`, { headers: { "content-type": "text/event-stream" } });
const call = (name: string, args: unknown, id = "c1") => ({ type: "function_call", call_id: id, name, arguments: JSON.stringify(args) });
const text = (t: string) => ({ type: "message", content: [{ text: t }] });

/** Answers each request in turn with the next output and records the request bodies. */
function stubReplies(outputs: unknown[][]) {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes("models.json")) return new Response("{}", { status: 404 });
    bodies.push(JSON.parse(String(init?.body)));
    return sse(outputs[Math.min(bodies.length - 1, outputs.length - 1)]);
  });
  return bodies;
}

const grok = { provider: "grok" as const, accessToken: "t", refreshToken: "r", expiresAt: 0 };
const codex = { provider: "codex" as const, accessToken: "t", refreshToken: "r", expiresAt: 0, accountId: "a" };
const echo: AgentTool<{ n: number }> = { name: "echo", description: "Echo", args: z.object({ n: z.number() }), label: (a) => `Echo ${a.n}`, run: async (a) => ({ got: a.n, third: a.n / 3 }) };
const tools = [echo] as unknown as AgentTool<never>[];

afterEach(() => vi.unstubAllGlobals());

describe("converse", () => {
  it("describes tools with JSON Schema from their zod arguments", () => {
    expect(toolSpec(echo as unknown as AgentTool<never>)).toEqual({
      type: "function",
      name: "echo",
      description: "Echo",
      parameters: { type: "object", properties: { n: { type: "number" } }, required: ["n"] },
    });
  });

  it("runs calls, reports them, and feeds the results back until the model answers", async () => {
    const bodies = stubReplies([[call("echo", { n: 2 })], [text("Two.")]]);
    const progress: unknown[] = [];
    expect(await converse(grok, "Be brief.", [{ role: "user", content: "hi" }], tools, (p) => progress.push(p))).toBe("Two.");
    expect(progress).toEqual([{ type: "lookup", label: "Echo 2" }]);
    expect(bodies[1].input).toEqual([
      { role: "system", content: "Be brief." },
      { role: "user", content: "hi" },
      call("echo", { n: 2 }),
      { type: "function_call_output", call_id: "c1", output: '{"got":2,"third":0.667}' },
    ]);
  });

  it("passes calls and outputs through unchanged to the ChatGPT backend", async () => {
    const bodies = stubReplies([[call("echo", { n: 1 })], [text("One.")]]);
    await converse(codex, "Be brief.", [{ role: "user", content: "hi" }], tools, () => {});
    expect(bodies[1].instructions).toBe("Be brief.");
    expect(bodies[1].input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "hi" }] },
      call("echo", { n: 1 }),
      { type: "function_call_output", call_id: "c1", output: '{"got":1,"third":0.333}' },
    ]);
  });

  it("returns unknown tools and bad arguments to the model as errors", async () => {
    const bodies = stubReplies([[call("nope", {}, "a"), call("echo", { n: "x" }, "b")], [text("Sorry.")]]);
    await converse(grok, "x", [{ role: "user", content: "hi" }], tools, () => {});
    const outputs = (bodies[1].input as { type?: string; output?: string }[]).filter((i) => i.type === "function_call_output").map((i) => JSON.parse(i.output!).error);
    expect(outputs[0]).toMatch(/no tool named nope/);
    expect(outputs[1]).toMatch(/Invalid arguments: n/);
  });

  it("makes the model answer once it has used its rounds", async () => {
    const bodies = stubReplies([[call("echo", { n: 1 })], [call("echo", { n: 1 }), text("Here's what I have.")]]);
    expect(await converse(grok, "x", [{ role: "user", content: "hi" }], tools, () => {})).toBe("Here's what I have.");
    expect(bodies).toHaveLength(MAX_ROUNDS + 1);
    expect(bodies.at(-1)!.tool_choice).toBe("none");
    expect(bodies[0].tool_choice).toBeUndefined();
  });
});

describe("find_races", () => {
  const race = (id: number, over: Partial<RaceSummary>): RaceSummary => ({
    id,
    office: "house",
    state: "PA",
    district: id,
    title: `PA-${id}`,
    reporting: 0,
    total: 0,
    candidates: [],
    rating: null,
    ...over,
  });
  // Leader first, as civicAPI's candidates come.
  const counted = (d: number, r: number) =>
    [
      { name: "Dee", party: "Democratic", votes: d, pct: d, winner: false, incumbent: false },
      { name: "Arr", party: "Republican", votes: r, pct: r, winner: false, incumbent: false },
    ].sort((a, b) => b.votes - a.votes);
  const forecast = (pD: number) => ({ market: null, polls: null, rating: null, forecast: { odds: { D: pD, R: 1 - pD } } }) as unknown as RaceSummary["signal"];
  const races = [
    race(1, { rating: "tossup", signal: forecast(0.52), total: 100, reporting: 80, candidates: counted(49, 51) }),
    race(2, { rating: "likely-d", signal: forecast(0.85), total: 100, reporting: 90, candidates: counted(60, 40) }),
    race(3, { office: "senate", district: null, state: "OH", title: "Ohio Senate", signal: forecast(0.3) }),
  ];

  it("filters by office, margin and reporting, closest count first", () => {
    const found = findRaces(races, { office: ["house"], maxMargin: 5, minReporting: 50, sort: "closest_count", limit: 40 }, []);
    expect(found.matched).toBe(1);
    expect(found.races[0]).toMatchObject({ id: 1, margin: 2, leader: "Arr (Republican) 51%", chances: { D: 52, R: 48 }, status: "counting" });
  });

  it("sorts the closest forecasts first, filters by favorite, state, text and stars", () => {
    expect(findRaces(races, { sort: "closest_forecast", limit: 2 }, []).races.map((r) => r.id)).toEqual([1, 3]);
    expect(findRaces(races, { favored: "R", sort: "state", limit: 40 }, []).races.map((r) => r.id)).toEqual([3]);
    expect(findRaces(races, { states: ["oh"], sort: "state", limit: 40 }, []).races.map((r) => r.id)).toEqual([3]);
    expect(findRaces(races, { text: "dee", sort: "state", limit: 40 }, []).races.map((r) => r.id)).toEqual([1, 2]);
    expect(findRaces(races, { starred: true, sort: "state", limit: 40 }, [2]).races.map((r) => r.id)).toEqual([2]);
  });

  it("leaves the leader and margin out before any votes", () => {
    expect(raceRow(races[2])).toMatchObject({ leader: null, margin: null, status: "awaiting", votes: 0 });
  });
});
