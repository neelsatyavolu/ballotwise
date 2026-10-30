import { describe, expect, it } from "vitest";
import { createServe, type ServeDeps } from "../lib/midterms/staleServe";

type Answer = { fetchedAt: number; n: number };
const FRESH = 1000;
const WAIT = 50;
const STUCK = 5000;

function setup(stored: Record<string, Answer> = {}) {
  let clock = 10_000;
  const later: Promise<unknown>[] = [];
  const saved: Record<string, Answer> = { ...stored };
  const deps: ServeDeps = {
    now: () => clock,
    read: async (key) => saved[key] ?? null,
    write: async (key, value) => {
      saved[key] = value as Answer;
    },
    later: (work) => later.push(work),
    freshMs: FRESH,
    waitMs: WAIT,
    stuckMs: STUCK,
  };
  return { serve: createServe(deps), saved, later, tick: (ms: number) => (clock += ms), at: () => clock };
}

const never = () => new Promise<Answer>(() => {});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createServe", () => {
  it("loads once and reuses the answer while it's fresh", async () => {
    const s = setup();
    let loads = 0;
    const load = async () => ({ fetchedAt: s.at(), n: ++loads });
    expect((await s.serve<Answer>("US", load)).n).toBe(1);
    s.tick(FRESH - 1);
    expect((await s.serve<Answer>("US", load)).n).toBe(1);
    expect(loads).toBe(1);
  });

  it("starts a fresh isolate from the saved copy without asking the source", async () => {
    const s = setup({ US: { fetchedAt: 9_500, n: 7 } });
    const answer = await s.serve<Answer>("US", () => Promise.reject(new Error("should not load")));
    expect(answer.n).toBe(7);
  });

  it("serves the older copy when the source is slow, and keeps refreshing after the response", async () => {
    const s = setup({ US: { fetchedAt: 1, n: 1 } });
    let finish!: (a: Answer) => void;
    const answer = await s.serve<Answer>("US", () => new Promise<Answer>((r) => (finish = r)));
    expect(answer.n).toBe(1);
    expect(s.later).toHaveLength(1);
    finish({ fetchedAt: s.at(), n: 2 });
    await s.later[0];
    expect(s.saved.US.n).toBe(2);
    expect((await s.serve<Answer>("US", never)).n).toBe(2);
  });

  it("serves the older copy when the source fails", async () => {
    const s = setup({ US: { fetchedAt: 1, n: 1 } });
    expect((await s.serve<Answer>("US", () => Promise.reject(new Error("503")))).n).toBe(1);
  });

  it("passes the error on when there's nothing older to serve", async () => {
    const s = setup();
    await expect(s.serve<Answer>("US", () => Promise.reject(new Error("503")))).rejects.toThrow("503");
  });

  it("shares one fetch between requests arriving together", async () => {
    const s = setup();
    let loads = 0;
    const load = async () => {
      loads++;
      await sleep(5);
      return { fetchedAt: s.at(), n: loads };
    };
    const [a, b] = await Promise.all([s.serve<Answer>("US", load), s.serve<Answer>("US", load)]);
    expect([a.n, b.n, loads]).toEqual([1, 1, 1]);
  });

  it("gives up on a fetch that has hung past the stuck limit and starts another", async () => {
    const s = setup({ US: { fetchedAt: 1, n: 1 } });
    await s.serve<Answer>("US", never);
    s.tick(STUCK);
    let loads = 0;
    await s.serve<Answer>("US", async () => ({ fetchedAt: s.at(), n: 10 + ++loads }));
    // The first fetch never settles; the second is the one kept alive last.
    await s.later.at(-1);
    expect(loads).toBe(1);
    expect(s.saved.US.n).toBe(11);
  });

  it("still answers when the saved-copy store is down", async () => {
    const broken = createServe({ now: () => 0, read: () => Promise.reject(new Error("D1")), write: () => Promise.reject(new Error("D1")), later: () => {}, freshMs: FRESH, waitMs: WAIT, stuckMs: STUCK });
    expect((await broken<Answer>("US", async () => ({ fetchedAt: 0, n: 3 }))).n).toBe(3);
  });
});
