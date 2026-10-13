import type { Database, SqlValue } from "sql.js";

// node:sqlite's DatabaseSync API, implemented on sql.js (SQLite compiled to WebAssembly), so the server code
// runs unchanged inside the phone app. The runtime (../runtime.ts) loads sql.js and any saved database first.

export interface LocalSql {
  SQL: { Database: new (data?: Uint8Array) => Database };
  data: Uint8Array | null;
  db?: Database;
  dirty: boolean;
}
const state = () => (globalThis as unknown as { __aevumSql: LocalSql }).__aevumSql;

type Param = string | number | null;

class StatementSync {
  constructor(
    private db: Database,
    private sql: string,
  ) {}

  // A fresh sql.js statement per call, always freed: statements live in WebAssembly memory, not the JS heap.
  private use<T>(params: Param[], fn: (st: ReturnType<Database["prepare"]>) => T): T {
    const st = this.db.prepare(this.sql);
    try {
      if (params.length) st.bind(params as SqlValue[]);
      return fn(st);
    } finally {
      st.free();
    }
  }

  all(...params: Param[]) {
    return this.use(params, (st) => {
      const rows: Record<string, SqlValue>[] = [];
      while (st.step()) rows.push(st.getAsObject());
      return rows;
    });
  }

  get(...params: Param[]) {
    return this.use(params, (st) => (st.step() ? st.getAsObject() : undefined));
  }

  run(...params: Param[]) {
    this.use(params, (st) => st.step());
    state().dirty = true;
    const changes = this.db.getRowsModified();
    const id = this.db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0;
    return { changes, lastInsertRowid: Number(id) };
  }
}

export class DatabaseSync {
  private db: Database;
  constructor(_path: string) {
    const s = state();
    this.db = new s.SQL.Database(s.data ?? undefined);
    s.db = this.db;
  }
  exec(sql: string) {
    this.db.exec(sql);
    if (!/^\s*(PRAGMA|SELECT)\b/i.test(sql)) state().dirty = true;
  }
  prepare(sql: string) {
    return new StatementSync(this.db, sql);
  }
}
