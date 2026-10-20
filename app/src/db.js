import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('client','analyst')),
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_companies (
  user_id INTEGER NOT NULL REFERENCES users(id),
  inn TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (user_id, inn)
);
CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  inn TEXT NOT NULL,
  product TEXT NOT NULL,
  amount INTEGER NOT NULL,
  term INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  engine_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_offers_user ON offers(user_id, inn);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  inn TEXT NOT NULL,
  status TEXT NOT NULL,
  product TEXT NOT NULL,
  amount INTEGER NOT NULL,
  term INTEGER NOT NULL,
  collateral INTEGER NOT NULL DEFAULT 0,
  purpose TEXT,
  declared_revenue INTEGER,
  form TEXT NOT NULL DEFAULT '{}',
  accepted_terms TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  submitted_at TEXT,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_app_user ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_app_status ON applications(status);
CREATE TABLE IF NOT EXISTS application_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  public_text TEXT,
  internal_text TEXT,
  payload TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_app ON application_events(application_id);
CREATE TABLE IF NOT EXISTS enrichment_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER REFERENCES applications(id),
  inn TEXT NOT NULL,
  source TEXT NOT NULL,
  ok INTEGER NOT NULL,
  degraded INTEGER NOT NULL DEFAULT 0,
  payload TEXT,
  error TEXT,
  fetched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_enr_inn ON enrichment_snapshots(inn, source, fetched_at);
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  outcome TEXT NOT NULL,
  routing TEXT NOT NULL,
  score INTEGER,
  engine_version TEXT NOT NULL,
  made_by TEXT NOT NULL,
  final INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dec_app ON decisions(application_id);
CREATE TABLE IF NOT EXISTS info_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  kind TEXT NOT NULL,
  question TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  answer TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  answered_at TEXT
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'required',
  file_name TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (application_id, kind)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  application_id INTEGER REFERENCES applications(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);
CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  scope TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response TEXT NOT NULL,
  status INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (key, user_id, scope)
);
`;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  db.exec(SCHEMA);
  return db;
}

export const nowIso = () => new Date().toISOString();
export const json = (v) => (v === undefined || v === null ? null : JSON.stringify(v));
export const parse = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
