import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const X_LENS_DIR = join(homedir(), ".x-lens");
const MEMORY_FILE = join(X_LENS_DIR, "MEMORY.md");
const SESSIONS_DIR = join(X_LENS_DIR, "sessions");
const CONTEXT_FILE = join(SESSIONS_DIR, "context.jsonl");

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// -- MEMORY --

export function readMemory(): string {
  ensureDir(X_LENS_DIR);
  if (!existsSync(MEMORY_FILE)) return "(no memory yet)";
  const content = readFileSync(MEMORY_FILE, "utf-8").trim();
  return content || "(no memory yet)";
}

export function writeMemory(content: string): void {
  ensureDir(X_LENS_DIR);
  writeFileSync(MEMORY_FILE, content, "utf-8");
}

export function appendMemory(content: string): void {
  ensureDir(X_LENS_DIR);
  const existing = existsSync(MEMORY_FILE) ? readFileSync(MEMORY_FILE, "utf-8") : "";
  writeFileSync(MEMORY_FILE, existing + "\n" + content, "utf-8");
}

export function getMemoryPath(): string {
  return MEMORY_FILE;
}

// -- SESSION PERSISTENCE --

export interface SessionEntry {
  timestamp: string;
  role: "user" | "assistant" | "toolResult";
  content: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
}

export function loadSession(): SessionEntry[] {
  ensureDir(SESSIONS_DIR);
  if (!existsSync(CONTEXT_FILE)) return [];
  try {
    const lines = readFileSync(CONTEXT_FILE, "utf-8").trim().split("\n").filter(Boolean);
    return lines.map((line) => JSON.parse(line) as SessionEntry);
  } catch {
    return [];
  }
}

export function appendToSession(entry: SessionEntry): void {
  ensureDir(SESSIONS_DIR);
  appendFileSync(CONTEXT_FILE, JSON.stringify(entry) + "\n", "utf-8");
}

export function clearSession(): void {
  ensureDir(SESSIONS_DIR);
  writeFileSync(CONTEXT_FILE, "", "utf-8");
}

export function getSessionPath(): string {
  return CONTEXT_FILE;
}
