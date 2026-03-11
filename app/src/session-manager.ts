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

/**
 * Repair messages to fix tool_use/toolResult mismatches.
 * Ensures every toolResult has a matching toolUse in the preceding assistant message.
 * Removes orphan toolResults and trailing assistant messages with no response.
 */
export function repairMessages(messages: Message[]): Message[] {
  if (messages.length === 0) return messages;

  const repaired: Message[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i] as any;

    if (msg.role === "toolResult") {
      // Find the preceding assistant message
      let prevAssistant: any = null;
      for (let j = repaired.length - 1; j >= 0; j--) {
        if ((repaired[j] as any).role === "assistant") {
          prevAssistant = repaired[j];
          break;
        }
      }

      if (!prevAssistant) {
        // No preceding assistant — skip this orphan toolResult
        continue;
      }

      // Count toolUse blocks in the preceding assistant message
      const toolUseIds = new Set<string>();
      const content = prevAssistant.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_use" || block.type === "toolUse") {
            toolUseIds.add(block.id);
          }
        }
      }

      // Count existing toolResults already added for this assistant
      const existingResultIds = new Set<string>();
      for (let j = repaired.length - 1; j >= 0; j--) {
        const r = repaired[j] as any;
        if (r.role === "assistant") break;
        if (r.role === "toolResult" && r.toolCallId) {
          existingResultIds.add(r.toolCallId);
        }
      }

      // Only add if this toolResult matches a toolUse and isn't a duplicate
      const resultId = msg.toolCallId;
      if (resultId && toolUseIds.has(resultId) && !existingResultIds.has(resultId)) {
        repaired.push(msg);
      } else if (!resultId) {
        // No toolCallId — check count-based: don't exceed number of toolUse blocks
        if (existingResultIds.size < toolUseIds.size) {
          repaired.push(msg);
        }
      }
      // else: orphan or duplicate — skip
    } else {
      repaired.push(msg);
    }
  }

  // Remove trailing assistant message with tool_use that has no results
  // (indicates interrupted execution)
  while (repaired.length > 0) {
    const last = repaired[repaired.length - 1] as any;
    if (last.role === "assistant") {
      const content = last.content;
      const hasToolUse = Array.isArray(content) && content.some(
        (b: any) => b.type === "tool_use" || b.type === "toolUse"
      );
      if (hasToolUse) {
        // Check if all tool_use blocks have matching results
        const toolUseIds = new Set<string>();
        for (const b of content) {
          if (b.type === "tool_use" || b.type === "toolUse") toolUseIds.add(b.id);
        }
        // No results follow — remove this incomplete assistant message
        repaired.pop();
        continue;
      }
    }
    break;
  }

  return repaired;
}

export function loadPersonaSession(persona: string): Message[] {
  ensureDir(SESSIONS_DIR);
  const file = getPersonaSessionPath(persona);
  if (!existsSync(file)) return [];
  try {
    const lines = readFileSync(file, "utf-8").trim().split("\n").filter(Boolean);
    const messages = lines.map((line) => JSON.parse(line) as Message);
    const repaired = repairMessages(messages);
    if (repaired.length !== messages.length) {
      // Auto-save the repaired session
      savePersonaSession(persona, repaired);
    }
    return repaired;
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
