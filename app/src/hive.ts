/**
 * The Hive — structured, queryable time-series data layer for the trader persona.
 *
 * Accumulates daily market observations, signals, regime states, and validations.
 * Over time, builds patterns by tracking which signals played out correctly.
 *
 * Storage: ~/.x-lens/hive.db (SQLite with WAL mode)
 */

import Database from "better-sqlite3";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

const X_LENS_DIR = join(homedir(), ".x-lens");
const DB_PATH = join(X_LENS_DIR, "hive.db");

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

let _db: Database.Database | null = null;

export function getHiveDb(): Database.Database {
  if (_db) return _db;
  ensureDir(X_LENS_DIR);
  _db = new Database(DB_PATH, {});
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  return _db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    -- Core events table: flexible schema, agent decides the structure
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      date TEXT,                              -- YYYY-MM-DD (optional, defaults to today)
      type TEXT DEFAULT '',                   -- agent-defined: regime_check, signal, trade, news, anything
      category TEXT DEFAULT '',               -- agent-defined grouping
      ticker TEXT,                            -- optional
      data TEXT DEFAULT '{}',                 -- JSON blob, any shape
      source_skill TEXT,
      confidence REAL,
      summary TEXT DEFAULT '',
      created_at TEXT,
      tags TEXT DEFAULT '',                   -- comma-separated freeform tags

      -- Validation (filled in later)
      validated INTEGER DEFAULT 0,
      outcome TEXT,                           -- agent-defined: correct, wrong, early, missed, anything
      validated_at TEXT,
      validation_notes TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_events_date ON events(date DESC);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_ticker ON events(ticker);
    CREATE INDEX IF NOT EXISTS idx_events_validated ON events(validated);
    CREATE INDEX IF NOT EXISTS idx_events_category ON events(category);

    -- Patterns: fully flexible, agent-defined
    CREATE TABLE IF NOT EXISTS patterns (
      id TEXT PRIMARY KEY,
      name TEXT DEFAULT '',
      description TEXT DEFAULT '',
      category TEXT DEFAULT '',
      data TEXT DEFAULT '{}',                -- any JSON: conditions, thresholds, correlations
      tags TEXT DEFAULT '',                  -- freeform tags
      win_rate REAL,
      sample_size INTEGER DEFAULT 0,
      last_updated TEXT,
      created_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_patterns_category ON patterns(category);

    -- Runs: every execution, auto-captured
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      source TEXT DEFAULT '',
      persona TEXT DEFAULT '',
      job_id TEXT,
      prompt TEXT DEFAULT '',
      response TEXT DEFAULT '',
      status TEXT DEFAULT 'running',
      error_message TEXT,
      tool_count INTEGER DEFAULT 0,
      started_at TEXT,
      ended_at TEXT,
      duration_ms INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_source ON runs(source);
    CREATE INDEX IF NOT EXISTS idx_runs_persona ON runs(persona);
    CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);

    -- Simulations: links to simulation output directories
    CREATE TABLE IF NOT EXISTS simulations (
      id TEXT PRIMARY KEY,
      scenario TEXT DEFAULT '',
      platform TEXT DEFAULT 'twitter',
      agent_count INTEGER DEFAULT 0,
      action_count INTEGER DEFAULT 0,
      sim_dir TEXT DEFAULT '',
      report_summary TEXT,
      created_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_simulations_created ON simulations(created_at DESC);
  `);
}

// ---------------------------------------------------------------------------
// Event CRUD
// ---------------------------------------------------------------------------

export interface HiveEvent {
  id: string;
  date: string;
  type: string;
  category: string;
  ticker: string | null;
  data: Record<string, unknown>;
  source_skill: string | null;
  confidence: number | null;
  summary: string;
  tags: string;
  created_at: string;
  validated: boolean;
  outcome: string | null;
  validated_at: string | null;
  validation_notes: string | null;
}

export function recordEvent(opts: {
  date?: string;
  type?: string;
  category?: string;
  ticker?: string;
  data?: Record<string, unknown>;
  source_skill?: string;
  confidence?: number;
  summary?: string;
  tags?: string;
}): string {
  const db = getHiveDb();
  const id = randomUUID();
  const today = new Date().toISOString().split("T")[0];
  db.prepare(`
    INSERT INTO events (id, date, type, category, ticker, data, source_skill, confidence, summary, tags, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    opts.date || today,
    opts.type || "",
    opts.category || "",
    opts.ticker || null,
    JSON.stringify(opts.data || {}),
    opts.source_skill || null,
    opts.confidence ?? null,
    opts.summary || "",
    opts.tags || "",
    new Date().toISOString(),
  );
  return id;
}

export function validateEvent(opts: {
  id: string;
  outcome: string;
  notes?: string;
}): boolean {
  const db = getHiveDb();
  const result = db.prepare(`
    UPDATE events SET validated = 1, outcome = ?, validated_at = ?, validation_notes = ?
    WHERE id = ?
  `).run(opts.outcome, new Date().toISOString(), opts.notes || null, opts.id);
  return result.changes > 0;
}

export function queryEvents(opts: {
  from?: string;
  to?: string;
  type?: string;
  category?: string;
  ticker?: string;
  validated?: boolean;
  limit?: number;
}): HiveEvent[] {
  const db = getHiveDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (opts.from) { conditions.push("date >= ?"); params.push(opts.from); }
  if (opts.to) { conditions.push("date <= ?"); params.push(opts.to); }
  if (opts.type) { conditions.push("type = ?"); params.push(opts.type); }
  if (opts.category) { conditions.push("category = ?"); params.push(opts.category); }
  if (opts.ticker) { conditions.push("ticker = ?"); params.push(opts.ticker); }
  if (opts.validated !== undefined) { conditions.push("validated = ?"); params.push(opts.validated ? 1 : 0); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts.limit ?? 100;
  params.push(limit);

  const rows = db.prepare(`
    SELECT * FROM events ${where} ORDER BY date DESC, created_at DESC LIMIT ?
  `).all(...params) as any[];

  return rows.map(rowToEvent);
}

export function getPendingValidations(opts: { olderThanDays?: number } = {}): HiveEvent[] {
  const db = getHiveDb();
  const days = opts.olderThanDays ?? 1;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  const rows = db.prepare(`
    SELECT * FROM events
    WHERE validated = 0 AND date <= ?
    ORDER BY date DESC
    LIMIT 50
  `).all(cutoffStr) as any[];

  return rows.map(rowToEvent);
}

export function getTimeline(opts: { from: string; to: string }): HiveEvent[] {
  const db = getHiveDb();
  const rows = db.prepare(`
    SELECT * FROM events WHERE date >= ? AND date <= ? ORDER BY date ASC, created_at ASC
  `).all(opts.from, opts.to) as any[];
  return rows.map(rowToEvent);
}

// ---------------------------------------------------------------------------
// Pattern CRUD
// ---------------------------------------------------------------------------

export interface HivePattern {
  id: string;
  name: string;
  description: string;
  category: string;
  data: Record<string, unknown>;
  tags: string;
  win_rate: number | null;
  sample_size: number;
  last_updated: string;
  created_at: string;
}

export function upsertPattern(opts: {
  id?: string;
  name?: string;
  description?: string;
  category?: string;
  data?: Record<string, unknown>;
  tags?: string;
  win_rate?: number;
  sample_size?: number;
}): string {
  const db = getHiveDb();
  const id = opts.id || randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO patterns (id, name, description, category, data, tags, win_rate, sample_size, last_updated, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      category = excluded.category,
      data = excluded.data,
      tags = excluded.tags,
      win_rate = excluded.win_rate,
      sample_size = excluded.sample_size,
      last_updated = excluded.last_updated
  `).run(id, opts.name || "", opts.description || "", opts.category || "", JSON.stringify(opts.data || {}), opts.tags || "", opts.win_rate ?? null, opts.sample_size ?? 0, now, now);
  return id;
}

export function queryPatterns(opts: { category?: string; tags?: string } = {}): HivePattern[] {
  const db = getHiveDb();
  const conditions: string[] = [];
  const params: any[] = [];
  if (opts.category) { conditions.push("category = ?"); params.push(opts.category); }
  if (opts.tags) { conditions.push("tags LIKE ?"); params.push(`%${opts.tags}%`); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT * FROM patterns ${where} ORDER BY win_rate DESC NULLS LAST`).all(...params) as any[];
  return rows.map((r) => ({
    ...r,
    data: JSON.parse(r.data || "{}"),
    tags: r.tags || "",
  }));
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface AccuracyByType {
  type: string;
  win_rate: number | null;
  validated: number;
  total: number;
}

export function getAccuracyByType(): AccuracyByType[] {
  const db = getHiveDb();
  const rows = db.prepare(`
    SELECT
      type,
      COUNT(*) as total,
      SUM(CASE WHEN validated = 1 THEN 1 ELSE 0 END) as validated,
      SUM(CASE WHEN outcome = 'correct' THEN 1 ELSE 0 END) as correct
    FROM events
    WHERE type != ''
    GROUP BY type
    ORDER BY total DESC
  `).all() as any[];

  return rows.map((r) => ({
    type: r.type,
    win_rate: r.validated > 0 ? r.correct / r.validated : null,
    validated: r.validated,
    total: r.total,
  }));
}

export function getStats(): {
  totalEvents: number;
  validated: number;
  pending: number;
  byOutcome: Record<string, number>;
  byType: Record<string, number>;
  patternCount: number;
  dateRange: { earliest: string | null; latest: string | null };
} {
  const db = getHiveDb();

  const total = (db.prepare("SELECT COUNT(*) as n FROM events").get() as any).n;
  const validated = (db.prepare("SELECT COUNT(*) as n FROM events WHERE validated = 1").get() as any).n;
  const pending = (db.prepare("SELECT COUNT(*) as n FROM events WHERE validated = 0").get() as any).n;
  const patternCount = (db.prepare("SELECT COUNT(*) as n FROM patterns").get() as any).n;

  const outcomeRows = db.prepare("SELECT outcome, COUNT(*) as n FROM events WHERE validated = 1 GROUP BY outcome").all() as any[];
  const byOutcome: Record<string, number> = {};
  for (const r of outcomeRows) byOutcome[r.outcome || "unknown"] = r.n;

  const typeRows = db.prepare("SELECT type, COUNT(*) as n FROM events GROUP BY type").all() as any[];
  const byType: Record<string, number> = {};
  for (const r of typeRows) byType[r.type] = r.n;

  const range = db.prepare("SELECT MIN(date) as earliest, MAX(date) as latest FROM events").get() as any;

  return { totalEvents: total, validated, pending, byOutcome, byType, patternCount, dateRange: { earliest: range.earliest, latest: range.latest } };
}

// ---------------------------------------------------------------------------
// Runs — auto-capture every execution
// ---------------------------------------------------------------------------

export interface HiveRun {
  id: string;
  source: string;
  persona: string;
  job_id: string | null;
  prompt: string;
  response: string;
  status: string;
  error_message: string | null;
  tool_count: number;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
}

export function startRun(opts: {
  id: string;
  source: "cli" | "daemon" | "pipe" | "telegram";
  persona?: string;
  job_id?: string;
  prompt: string;
}): void {
  const db = getHiveDb();
  db.prepare(`
    INSERT OR IGNORE INTO runs (id, source, persona, job_id, prompt, started_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(opts.id, opts.source, opts.persona || "", opts.job_id || null, opts.prompt, new Date().toISOString());
}

export function endRun(opts: {
  id: string;
  response: string;
  status: "completed" | "error";
  error_message?: string;
  tool_count?: number;
}): void {
  const db = getHiveDb();
  const now = new Date().toISOString();
  const row = db.prepare("SELECT started_at FROM runs WHERE id = ?").get(opts.id) as any;
  const durationMs = row ? Date.now() - new Date(row.started_at).getTime() : null;

  db.prepare(`
    UPDATE runs SET response = ?, status = ?, error_message = ?, tool_count = ?, ended_at = ?, duration_ms = ?
    WHERE id = ?
  `).run(
    opts.response.slice(0, 10000),
    opts.status,
    opts.error_message || null,
    opts.tool_count ?? 0,
    now,
    durationMs,
    opts.id,
  );
}

export function queryRuns(opts: {
  source?: string;
  persona?: string;
  limit?: number;
} = {}): HiveRun[] {
  const db = getHiveDb();
  const conditions: string[] = [];
  const params: any[] = [];
  if (opts.source) { conditions.push("source = ?"); params.push(opts.source); }
  if (opts.persona) { conditions.push("persona = ?"); params.push(opts.persona); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(opts.limit ?? 50);
  return db.prepare(`SELECT * FROM runs ${where} ORDER BY started_at DESC LIMIT ?`).all(...params) as HiveRun[];
}

// ---------------------------------------------------------------------------
// Simulations — track simulation output
// ---------------------------------------------------------------------------

export interface HiveSimulation {
  id: string;
  scenario: string;
  platform: string;
  agent_count: number;
  action_count: number;
  sim_dir: string;
  report_summary: string | null;
  created_at: string;
}

export function recordSimulation(opts: {
  id: string;
  scenario: string;
  platform?: string;
  agent_count: number;
  action_count: number;
  sim_dir: string;
  report_summary?: string;
}): void {
  const db = getHiveDb();
  db.prepare(`
    INSERT OR REPLACE INTO simulations (id, scenario, platform, agent_count, action_count, sim_dir, report_summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(opts.id, opts.scenario, opts.platform || "twitter", opts.agent_count, opts.action_count, opts.sim_dir, opts.report_summary?.slice(0, 2000) || null, new Date().toISOString());
}

export function querySimulations(limit = 20): HiveSimulation[] {
  const db = getHiveDb();
  return db.prepare("SELECT * FROM simulations ORDER BY created_at DESC LIMIT ?").all(limit) as HiveSimulation[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToEvent(r: any): HiveEvent {
  return {
    id: r.id,
    date: r.date || "",
    type: r.type || "",
    category: r.category || "",
    ticker: r.ticker,
    data: JSON.parse(r.data || "{}"),
    source_skill: r.source_skill,
    confidence: r.confidence,
    summary: r.summary || "",
    tags: r.tags || "",
    created_at: r.created_at || "",
    validated: r.validated === 1,
    outcome: r.outcome,
    validated_at: r.validated_at,
    validation_notes: r.validation_notes,
  };
}
