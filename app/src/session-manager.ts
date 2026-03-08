import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Message } from "@mariozechner/pi-ai";

const X_LENS_DIR = join(homedir(), ".x-lens");
const SESSIONS_DIR = join(X_LENS_DIR, "sessions");

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function getPersonaSessionPath(persona: string): string {
  return join(SESSIONS_DIR, `${persona}.jsonl`);
}

export function loadPersonaSession(persona: string): Message[] {
  ensureDir(SESSIONS_DIR);
  const file = getPersonaSessionPath(persona);
  if (!existsSync(file)) return [];
  try {
    const lines = readFileSync(file, "utf-8").trim().split("\n").filter(Boolean);
    return lines.map((line) => JSON.parse(line) as Message);
  } catch {
    return [];
  }
}

export function appendPersonaSessionMessage(persona: string, message: Message): void {
  ensureDir(SESSIONS_DIR);
  appendFileSync(getPersonaSessionPath(persona), JSON.stringify(message) + "\n", "utf-8");
}

export function savePersonaSession(persona: string, messages: Message[]): void {
  ensureDir(SESSIONS_DIR);
  const content = messages.map((m) => JSON.stringify(m)).join("\n") + (messages.length > 0 ? "\n" : "");
  writeFileSync(getPersonaSessionPath(persona), content, "utf-8");
}

export function clearPersonaSession(persona: string): void {
  ensureDir(SESSIONS_DIR);
  writeFileSync(getPersonaSessionPath(persona), "", "utf-8");
}
