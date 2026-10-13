import { beforeAll, describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import { DatabaseSync as NodeDb } from "node:sqlite";
import { DatabaseSync as LocalDb, type LocalSql } from "../src/local/shims/sqlite";

// The phone app runs the server code on sql.js through this shim. Same statements, same results as node:sqlite.

let SQL: LocalSql["SQL"];
beforeAll(async () => {
  SQL = (await initSqlJs()) as unknown as LocalSql["SQL"];
});

function fresh(data: Uint8Array | null = null) {
  (globalThis as unknown as { __aevumSql: LocalSql }).__aevumSql = { SQL, data, dirty: false };
  return new LocalDb(":memory:");
}
const state = () => (globalThis as unknown as { __aevumSql: LocalSql }).__aevumSql;

const SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE metrics (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, ts INTEGER NOT NULL, value REAL NOT NULL, PRIMARY KEY (user_id, ts)) WITHOUT ROWID;
  CREATE TABLE log (id INTEGER PRIMARY KEY AUTOINCREMENT, msg TEXT);
`;

type Db = {
  exec(s: string): void;
  prepare(s: string): {
    all(...p: (string | number | null)[]): unknown[];
    get(...p: (string | number | null)[]): unknown;
    run(...p: (string | number | null)[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  };
};

function scenario(db: Db) {
  db.exec(SCHEMA);
  db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run("u1", "Τάσος");
  const up = db.prepare("INSERT INTO metrics (user_id, ts, value) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET value = excluded.value");
  db.exec("BEGIN");
  for (let i = 0; i < 5; i++) up.run("u1", 1000 + i, i * 1.5);
  up.run("u1", 1000, 99);
  db.exec("COMMIT");
  const log = db.prepare("INSERT INTO log (msg) VALUES (?)").run("hello");
  const rows = db.prepare("SELECT ts, value FROM metrics WHERE user_id = ? ORDER BY ts").all("u1");
  const one = db.prepare("SELECT name FROM users WHERE id = ?").get("u1");
  const none = db.prepare("SELECT name FROM users WHERE id = ?").get("nope");
  const agg = db.prepare("SELECT COALESCE(MAX(ts), 0) AS v, AVG(value) AS a FROM metrics").get();
  const updated = Number(db.prepare("UPDATE metrics SET value = value + 1 WHERE ts >= ?").run(1003).changes);
  db.prepare("DELETE FROM users WHERE id = ?").run("u1");
  const cascade = db.prepare("SELECT COUNT(*) AS n FROM metrics").get();
  return { rows, one, none: none ?? null, agg, updated, logId: Number(log.lastInsertRowid), cascade };
}

describe("local-mode SQLite shim", () => {
  it("matches node:sqlite on the statements the server uses", () => {
    const expected = JSON.parse(JSON.stringify(scenario(new NodeDb(":memory:") as unknown as Db)));
    const actual = JSON.parse(JSON.stringify(scenario(fresh())));
    expect(actual).toEqual(expected);
    expect(actual.rows[0]).toEqual({ ts: 1000, value: 99 });
    expect(actual.none).toBeNull();
    expect(actual.updated).toBe(2);
    expect(actual.cascade).toEqual({ n: 0 });
  });

  it("marks writes dirty, and a saved database reopens with its data", () => {
    const db = fresh();
    db.exec("CREATE TABLE t (x INTEGER)");
    state().dirty = false;
    db.prepare("SELECT 1").all();
    expect(state().dirty).toBe(false);
    db.prepare("INSERT INTO t VALUES (?)").run(42);
    expect(state().dirty).toBe(true);
    const bytes = state().db!.export();
    const again = fresh(bytes);
    expect(again.prepare("SELECT x FROM t").get()).toEqual({ x: 42 });
  });
});
