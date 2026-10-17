import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Db, Statement } from "../lib/auth/accounts";

/** An in-memory SQLite database behind the D1 interface, with the real migrations applied. */
export function testDb(): Db {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  for (const file of ["0001_init.sql", "0002_ballot.sql", "0003_progress.sql", "0004_values.sql", "0005_cache.sql", "0006_measures.sql", "0007_terms.sql"]) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }

  const statement = (sql: string, values: unknown[] = []): Statement => ({
    bind: (...next) => statement(sql, next),
    first: async <T,>() => (sqlite.prepare(sql).get(...(values as never[])) as T) ?? null,
    all: async <T,>() => ({ results: sqlite.prepare(sql).all(...(values as never[])) as T[] }),
    run: async () => sqlite.prepare(sql).run(...(values as never[])),
  });

  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      sqlite.exec("BEGIN");
      try {
        for (const s of statements) await s.run();
        sqlite.exec("COMMIT");
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    },
  };
}
