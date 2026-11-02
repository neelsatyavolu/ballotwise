import { describe, expect, it } from "vitest";
import type { Db } from "../lib/auth/accounts";
import { forgetShared, getCachedShared, putCached, SHARED_CHECK_MS, SHARED_REREAD_MS } from "../lib/cache";
import { testDb } from "./sqlite-db";

/** testDb with every SQL statement it runs recorded in `seen`. */
function counted() {
  const db = testDb();
  const seen: string[] = [];
  const wrapped: Db = { ...db, prepare: (sql) => (seen.push(sql), db.prepare(sql)) };
  return { db: wrapped, seen };
}

const NOW = 1_800_000_000_000;

describe("getCachedShared", () => {
  it("keeps the parsed copy until its row is rewritten, checking with a light query", async () => {
    const { db, seen } = counted();
    const key = `shared-test:${Math.random()}`;
    await putCached(db, key, { v: 1 }, NOW);
    seen.length = 0;

    expect(await getCachedShared(db, key, NOW)).toEqual({ v: 1 });
    expect(seen.filter((s) => s.startsWith("SELECT data"))).toHaveLength(1);

    // Within the check interval: no database query at all.
    seen.length = 0;
    expect(await getCachedShared(db, key, NOW + SHARED_CHECK_MS - 1)).toEqual({ v: 1 });
    expect(seen).toHaveLength(0);

    // After it: one created_at check, no reread while the row is unchanged.
    expect(await getCachedShared(db, key, NOW + SHARED_CHECK_MS)).toEqual({ v: 1 });
    expect(seen).toEqual(["SELECT created_at, length(data) AS size FROM research_cache WHERE key = ?"]);

    // Rewritten by another isolate (bypassing this one's putCached): the next check rereads it.
    await db.prepare("UPDATE research_cache SET data = ?, created_at = ? WHERE key = ?").bind(JSON.stringify({ v: 2 }), NOW + 5, key).run();
    expect(await getCachedShared(db, key, NOW + 2 * SHARED_CHECK_MS)).toEqual({ v: 2 });
  });

  it("rereads a rewrite that kept the same time, by its length or after SHARED_REREAD_MS", async () => {
    const { db } = counted();
    const key = `shared-test:${Math.random()}`;
    await putCached(db, key, { v: 1 }, NOW);
    expect(await getCachedShared(db, key, NOW)).toEqual({ v: 1 });
    // Same time, different length (as odds.ts's backfill rewrites history).
    await db.prepare("UPDATE research_cache SET data = ? WHERE key = ?").bind(JSON.stringify({ v: 22 }), key).run();
    expect(await getCachedShared(db, key, NOW + SHARED_CHECK_MS)).toEqual({ v: 22 });
    // Same time and length: caught by the periodic full reread.
    await db.prepare("UPDATE research_cache SET data = ? WHERE key = ?").bind(JSON.stringify({ v: 33 }), key).run();
    expect(await getCachedShared(db, key, NOW + 2 * SHARED_CHECK_MS)).toEqual({ v: 22 });
    expect(await getCachedShared(db, key, NOW + SHARED_CHECK_MS + SHARED_REREAD_MS)).toEqual({ v: 33 });
  });

  it("rereads at once after this isolate writes or forgets the key", async () => {
    const { db } = counted();
    const key = `shared-test:${Math.random()}`;
    await putCached(db, key, { v: 1 }, NOW);
    expect(await getCachedShared(db, key, NOW)).toEqual({ v: 1 });
    await putCached(db, key, { v: 2 }, NOW + 1);
    expect(await getCachedShared(db, key, NOW + 2)).toEqual({ v: 2 });
    await db.prepare("UPDATE research_cache SET data = ?, created_at = ? WHERE key = ?").bind(JSON.stringify({ v: 3 }), NOW + 3, key).run();
    forgetShared(key);
    expect(await getCachedShared(db, key, NOW + 4)).toEqual({ v: 3 });
  });

  it("returns null for a missing or expired entry", async () => {
    const { db } = counted();
    const key = `shared-test:${Math.random()}`;
    expect(await getCachedShared(db, key, NOW)).toBeNull();
    await putCached(db, key, { v: 1 }, NOW);
    expect(await getCachedShared(db, key, NOW)).toEqual({ v: 1 });
    expect(await getCachedShared(db, key, NOW + 4 * 24 * 60 * 60 * 1000)).toBeNull();
  });
});
