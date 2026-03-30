import Database from "better-sqlite3";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";

const X_LENS_DIR = join(homedir(), ".x-lens");
const DB_PATH = join(X_LENS_DIR, "sessions.db");

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
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
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      persona TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      started_at REAL NOT NULL,
      ended_at REAL,
      message_count INTEGER NOT NULL DEFAULT 0,
      tool_call_count INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_name TEXT,
      timestamp REAL NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_persona ON sessions(persona);
  `);

  // FTS5 virtual table
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        content='messages',
        content_rowid='id'
      );
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
      END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
      END;
    `);
  } catch {
    // FTS already exists or not supported
  }
}

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

export function createSession(opts: {
  id: string;
  persona: string;
  model: string;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO sessions (id, persona, model, started_at) VALUES (?, ?, ?, ?)`,
  ).run(opts.id, opts.persona, opts.model, Date.now());
}

export function endSession(id: string): void {
  const db = getDb();
  db.prepare(`UPDATE sessions SET ended_at = ? WHERE id = ?`).run(Date.now(), id);
}

export function updateSessionTitle(id: string, title: string): void {
  const db = getDb();
  db.prepare(`UPDATE sessions SET title = ? WHERE id = ?`).run(title, id);
}

export function incrementSessionCounts(
  id: string,
  messages: number,
  toolCalls: number,
): void {
  const db = getDb();
  db.prepare(
    `UPDATE sessions SET message_count = message_count + ?, tool_call_count = tool_call_count + ? WHERE id = ?`,
  ).run(messages, toolCalls, id);
}

// ---------------------------------------------------------------------------
// Message CRUD
// ---------------------------------------------------------------------------

export interface StoredMessage {
  id: number;
  session_id: string;
  role: string;
  content: string;
  tool_name: string | null;
  timestamp: number;
}

export function insertMessage(opts: {
  sessionId: string;
  role: string;
  content: string;
  toolName?: string;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO messages (session_id, role, content, tool_name, timestamp) VALUES (?, ?, ?, ?, ?)`,
  ).run(opts.sessionId, opts.role, opts.content, opts.toolName ?? null, Date.now());
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchResult {
  sessionId: string;
  persona: string;
  title: string;
  startedAt: number;
  matchingMessages: { role: string; content: string; rank: number }[];
}

export function searchSessions(
  query: string,
  opts: {
    excludeSessionId?: string;
    persona?: string;
    limit?: number;
  } = {},
): SearchResult[] {
  const db = getDb();
  const limit = opts.limit ?? 5;

  const params: any[] = [query];
  let whereExtra = "";
  if (opts.excludeSessionId) {
    whereExtra += " AND m.session_id != ?";
    params.push(opts.excludeSessionId);
  }
  if (opts.persona) {
    whereExtra += " AND s.persona = ?";
    params.push(opts.persona);
  }

  const rows = db
    .prepare(
      `
      SELECT m.session_id, m.role, m.content, s.persona, s.title, s.started_at,
             rank
      FROM messages_fts fts
      JOIN messages m ON m.id = fts.rowid
      JOIN sessions s ON s.id = m.session_id
      WHERE messages_fts MATCH ?
      ${whereExtra}
      ORDER BY rank
      LIMIT 50
    `,
    )
    .all(...params) as any[];

  // Group by session
  const sessionMap = new Map<string, SearchResult>();
  for (const row of rows) {
    if (!sessionMap.has(row.session_id)) {
      sessionMap.set(row.session_id, {
        sessionId: row.session_id,
        persona: row.persona,
        title: row.title,
        startedAt: row.started_at,
        matchingMessages: [],
      });
    }
    sessionMap.get(row.session_id)!.matchingMessages.push({
      role: row.role,
      content: row.content,
      rank: row.rank,
    });
  }

  return Array.from(sessionMap.values())
    .sort((a, b) => Math.min(...a.matchingMessages.map((m) => m.rank)) - Math.min(...b.matchingMessages.map((m) => m.rank)))
    .slice(0, limit);
}

export function listRecentSessions(
  opts: { persona?: string; limit?: number } = {},
): { id: string; persona: string; title: string; startedAt: number; messageCount: number }[] {
  const db = getDb();
  const limit = opts.limit ?? 10;

  const params: any[] = [];
  let where = "";
  if (opts.persona) {
    where = "WHERE persona = ?";
    params.push(opts.persona);
  }
  params.push(limit);

  const rows = db
    .prepare(
      `SELECT id, persona, title, started_at, message_count FROM sessions ${where} ORDER BY started_at DESC LIMIT ?`,
    )
    .all(...params) as any[];

  return rows.map((r: any) => ({
    id: r.id,
    persona: r.persona,
    title: r.title,
    startedAt: r.started_at,
    messageCount: r.message_count,
  }));
}

export function getSessionMessages(
  sessionId: string,
  opts: { limit?: number } = {},
): StoredMessage[] {
  const db = getDb();
  const limit = opts.limit ?? 200;
  return db
    .prepare(`SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp LIMIT ?`)
    .all(sessionId, limit) as StoredMessage[];
}
