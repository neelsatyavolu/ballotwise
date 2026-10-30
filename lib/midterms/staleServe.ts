// Serving slow-changing answers from a flaky source: reuse while fresh, keep a saved copy for new isolates, and never
// make a visitor wait out a slow source when an older copy can answer instead.

type Stamped = { fetchedAt: number };

export type ServeDeps = {
  now: () => number;
  /** The saved copy under `key` (D1 in production), or null. Shared by every isolate. */
  read: (key: string) => Promise<unknown>;
  write: (key: string, value: unknown) => Promise<void>;
  /** Keeps work running after the response (Workers' waitUntil). */
  later: (work: Promise<unknown>) => void;
  /** An answer younger than this is served without asking the source. */
  freshMs: number;
  /** With an older copy to fall back on, a request waits this long for the source before serving that copy. */
  waitMs: number;
  /** A fetch unsettled after this long is presumed cut off (Workers end background work 30s after a response). */
  stuckMs: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Returns `serve(key, load)`. A fresh answer (in memory, else the saved copy) is served as is. Otherwise one refresh
 * runs, shared by requests arriving together and kept alive past the response, so a visitor leaving doesn't cut it
 * off for others waiting on it. With an older copy, a request waits up to `waitMs` for it and serves that copy on a
 * timeout or failure; without one, it waits for the refresh and gets its error.
 */
export function createServe(deps: ServeDeps) {
  const memo = new Map<string, Stamped>();
  const inFlight = new Map<string, { since: number; work: Promise<Stamped> }>();

  function refresh(key: string, load: () => Promise<Stamped>): Promise<Stamped> {
    const now = deps.now();
    const running = inFlight.get(key);
    if (running && now - running.since < deps.stuckMs) return running.work;
    const work = load().then(async (value) => {
      memo.set(key, value);
      await deps.write(key, value).catch((err) => console.error(`couldn't save ${key}:`, err));
      return value;
    });
    const entry = { since: now, work };
    inFlight.set(key, entry);
    deps.later(
      work
        .catch((err) => console.error(`refresh of ${key} failed:`, err))
        .finally(() => {
          if (inFlight.get(key) === entry) inFlight.delete(key);
        }),
    );
    return work;
  }

  return async function serve<T extends Stamped>(key: string, load: () => Promise<T>): Promise<T> {
    let held = memo.get(key) ?? null;
    if (!held) {
      held = ((await deps.read(key).catch(() => null)) as Stamped | null) ?? null;
      if (held && !memo.has(key)) memo.set(key, held);
    }
    if (held && deps.now() - held.fetchedAt < deps.freshMs) return held as T;
    const work = refresh(key, load);
    if (!held) return work as Promise<T>;
    const answer = await Promise.race([work.catch(() => null), sleep(deps.waitMs).then(() => null)]);
    return (answer ?? held) as T;
  };
}
