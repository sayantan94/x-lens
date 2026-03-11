import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Message } from "@mariozechner/pi-ai";
import { repairMessages } from "./session-manager.js";

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
// Stores full AgentMessages (user, assistant, toolResult) as JSONL
// This allows the agent to restore its full conversation context on restart,
// just like mom's SessionManager + context.jsonl pattern.

export function loadSessionMessages(): Message[] {
	ensureDir(SESSIONS_DIR);
	if (!existsSync(CONTEXT_FILE)) return [];
	try {
		const lines = readFileSync(CONTEXT_FILE, "utf-8").trim().split("\n").filter(Boolean);
		const messages = lines.map((line) => JSON.parse(line) as Message);
		const repaired = repairMessages(messages);
		if (repaired.length !== messages.length) {
			saveSessionMessages(repaired);
		}
		return repaired;
	} catch {
		return [];
	}
}

export function appendSessionMessage(message: Message): void {
	ensureDir(SESSIONS_DIR);
	appendFileSync(CONTEXT_FILE, JSON.stringify(message) + "\n", "utf-8");
}

export function saveSessionMessages(messages: Message[]): void {
	ensureDir(SESSIONS_DIR);
	const content = messages.map((m) => JSON.stringify(m)).join("\n") + (messages.length > 0 ? "\n" : "");
	writeFileSync(CONTEXT_FILE, content, "utf-8");
}

export function clearSession(): void {
	ensureDir(SESSIONS_DIR);
	writeFileSync(CONTEXT_FILE, "", "utf-8");
}

export function getSessionPath(): string {
	return CONTEXT_FILE;
}
