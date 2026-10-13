import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";

if (config.databasePath !== ":memory:") mkdirSync(dirname(config.databasePath), { recursive: true });

export const db = new DatabaseSync(config.databasePath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

// Each entry runs once, in order. Append new migrations; never edit old ones.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    locale TEXT NOT NULL DEFAULT 'el',
    birth_date TEXT,
    sex TEXT,
    height_cm REAL,
    goals TEXT NOT NULL DEFAULT '[]',
    plan TEXT,
    consent_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE expert_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    languages TEXT NOT NULL DEFAULT '["el","en"]',
    session_minutes INTEGER NOT NULL DEFAULT 45,
    accepting INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE availability (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expert_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    weekday INTEGER NOT NULL,      -- 0 = Sunday, in config.clinicTimeZone
    start_min INTEGER NOT NULL,    -- minutes from 00:00
    end_min INTEGER NOT NULL
  );

  CREATE TABLE care_team (
    member_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expert_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (member_id, expert_id)
  );

  CREATE TABLE bookings (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expert_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'booked',
    topic TEXT NOT NULL DEFAULT '',
    room_url TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX bookings_expert_time ON bookings(expert_id, starts_at);
  CREATE INDEX bookings_member_time ON bookings(member_id, starts_at);

  CREATE TABLE session_notes (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    visible_to_member INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expert_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    read_at INTEGER
  );
  CREATE INDEX messages_thread ON messages(member_id, expert_id, created_at);

  CREATE TABLE metrics (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    ts INTEGER NOT NULL,
    value REAL NOT NULL,
    source TEXT NOT NULL,
    PRIMARY KEY (user_id, type, ts, source)
  ) WITHOUT ROWID;

  CREATE TABLE sleep_sessions (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    start_ts INTEGER,
    end_ts INTEGER,
    total_min INTEGER NOT NULL,
    deep_min INTEGER,
    light_min INTEGER,
    rem_min INTEGER,
    awake_min INTEGER,
    score INTEGER,
    stages TEXT,
    source TEXT NOT NULL,
    PRIMARY KEY (user_id, date, source)
  );

  CREATE TABLE labs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    marker TEXT NOT NULL,
    value REAL NOT NULL,
    unit TEXT NOT NULL,
    ref_low REAL,
    ref_high REAL,
    taken_at INTEGER NOT NULL,
    entered_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    note TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX labs_user ON labs(user_id, marker, taken_at);

  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_sync_at INTEGER,
    revoked_at INTEGER
  );

  CREATE TABLE pairing_codes (
    code TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    claimed_at INTEGER
  );

  -- One row per API turn, stored exactly as sent/received so history replays unchanged.
  -- role 'snapshot' holds the member-data context frozen at conversation start.
  CREATE TABLE ai_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,          -- JSON: Anthropic content blocks (or snapshot text)
    created_at INTEGER NOT NULL
  );
  CREATE INDEX ai_messages_conv ON ai_messages(user_id, conversation_id, id);

  CREATE TABLE ai_insights (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, date)
  );
  `,
];

function migrate() {
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const row = db.prepare("SELECT COALESCE(MAX(id), 0) AS v FROM _migrations").get() as { v: number };
  for (let i = row.v; i < MIGRATIONS.length; i++) {
    tx(() => {
      db.exec(MIGRATIONS[i]);
      db.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(i + 1, Date.now());
    });
  }
}

export function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

type Param = string | number | null;

export function all<T>(sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: Param[]) {
  return db.prepare(sql).run(...params);
}

migrate();
