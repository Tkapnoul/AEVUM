import { App as CapApp } from "@capacitor/app";
import { Preferences } from "@capacitor/preferences";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import type { LocalSql } from "./shims/sqlite";

// Local mode: the whole AEVUM API runs inside the phone app. The same Hono app as on the server, with
// node:sqlite swapped for SQLite-in-WebAssembly (see vite.config.ts aliases). The database is kept in
// IndexedDB and saved a moment after every change and whenever the app goes to the background.

type Fetcher = { fetch: (req: Request) => Response | Promise<Response> };
let booting: Promise<Fetcher> | null = null;

const IDB = { name: "aevum-local", store: "kv", key: "db" };

function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(IDB.name, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(IDB.store);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(IDB.store, mode);
      const req = fn(tx.objectStore(IDB.store));
      tx.oncomplete = () => {
        open.result.close();
        resolve(req.result);
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}

const sql = () => (globalThis as unknown as { __aevumSql: LocalSql }).__aevumSql;

let saving: Promise<void> | null = null;

async function writeOnce() {
  const s = sql();
  if (!s?.db || !s.dirty) return;
  s.dirty = false;
  try {
    const data = s.db.export();
    // export() closes and reopens the database, which resets per-connection pragmas.
    s.db.exec("PRAGMA foreign_keys = ON;");
    await idb("readwrite", (st) => st.put(data, IDB.key));
  } catch (err) {
    s.dirty = true;
    console.error("[local] save failed", err);
  }
}

/** Persists pending changes; concurrent callers share one write and a change made meanwhile is written next. */
export async function saveNow(): Promise<void> {
  while (saving) await saving;
  if (!sql()?.dirty) return;
  saving = writeOnce().finally(() => (saving = null));
  await saving;
}

async function secret() {
  const k = "local_jwt_secret";
  const v = (await Preferences.get({ key: k })).value;
  if (v) return v;
  const fresh = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
  await Preferences.set({ key: k, value: fresh });
  return fresh;
}

export const getGeminiKey = async () => (await Preferences.get({ key: "gemini_key" })).value ?? "";
export async function setGeminiKey(key: string) {
  if (key.trim()) await Preferences.set({ key: "gemini_key", value: key.trim() });
  else await Preferences.remove({ key: "gemini_key" });
}

async function boot(): Promise<Fetcher> {
  const [jwt, gemini, initSqlJs, wasmUrl, saved] = await Promise.all([
    secret(),
    getGeminiKey(),
    import("sql.js").then((m) => m.default),
    import("sql.js/dist/sql-wasm-browser.wasm?url").then((m) => m.default),
    idb<Uint8Array | undefined>("readonly", (st) => st.get(IDB.key)).catch(() => undefined),
  ]);
  (globalThis as unknown as { process: { env: Record<string, string> } }).process = {
    env: {
      NODE_ENV: "production",
      JWT_SECRET: jwt,
      DATABASE_PATH: ":memory:",
      PUBLIC_URL: "https://localhost",
      AEVUM_LOCAL: "1",
      GEMINI_API_KEY: gemini,
    },
  };
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  (globalThis as unknown as { __aevumSql: LocalSql }).__aevumSql = { SQL, data: saved ?? null, dirty: false };

  Reflect.set(globalThis, "__aevumFetch", aiFetch);
  const { app } = await import("../../server/app");
  app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

  // Writes made after a response was sent (streamed chat, background reports) are caught by this timer.
  setInterval(() => void saveNow(), 1500);
  void CapApp.addListener("pause", () => void saveNow());
  window.addEventListener("pagehide", () => void saveNow());
  return app;
}

/**
 * fetch for the AI provider. The WebView fetch streams replies; if the provider refuses the request
 * cross-origin (CORS), the native HTTP client retries it without streaming (the reply arrives whole).
 */
async function aiFetch(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (!Capacitor.isNativePlatform() || !(err instanceof TypeError)) throw err;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const r = await CapacitorHttp.request({
      url: String(url),
      method: init?.method ?? "GET",
      headers: (init?.headers as Record<string, string>) ?? {},
      data: body,
      responseType: "text",
    });
    return new Response(typeof r.data === "string" ? r.data : JSON.stringify(r.data), { status: r.status, headers: r.headers });
  }
}

/** fetch() against the in-app API. */
export async function localFetch(path: string, init: RequestInit = {}): Promise<Response> {
  booting ??= boot();
  const app = await booting;
  const res = await app.fetch(new Request(new URL(path, "https://localhost"), init));
  // A change is on disk before the screen shows it as saved, so closing the app right after loses nothing.
  if ((init.method ?? "GET").toUpperCase() !== "GET") await saveNow();
  return res;
}
