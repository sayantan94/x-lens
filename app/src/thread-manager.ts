/**
 * Thread manager for concurrent agent execution.
 *
 * Each "thread" is an independent Agent instance with its own message history.
 * Multiple threads can run concurrently for the same persona, enabling parallel
 * job execution and non-blocking Telegram/IPC handling.
 *
 * Session continuity: each thread loads the persona's base session at start time.
 * New messages are appended to the shared persona session file (JSONL append is atomic).
 * Compaction uses a lock to prevent concurrent corruption.
 */

import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Api, Message, Model } from "@mariozechner/pi-ai";
import { loadPersonaSession, appendPersonaSessionMessage, savePersonaSession } from "./session-manager.js";
import { shouldCompact, compact } from "./compaction.js";

export interface ThreadConfig {
  persona: string;
  systemPrompt: string;
  model: Model<Api>;
  tools: AgentTool<any>[];
  convertToLlm: (messages: Message[]) => Message[] | Promise<Message[]>;
  /** Load base session from disk. If false, thread starts with empty context. */
  loadSession?: boolean;
  /** Session key override (e.g., "telegram-trader" vs "trader"). */
  sessionKey?: string;
}

export interface Thread {
  id: string;
  agent: Agent;
  persona: string;
  sessionKey: string;
  startedAt: number;
}

export class ThreadManager {
  private active = new Map<string, Thread>();
  private maxConcurrentPerPersona: number;
  private compactionLocks = new Set<string>();
  private threadCounter = 0;

  constructor(maxConcurrentPerPersona = 5) {
    this.maxConcurrentPerPersona = maxConcurrentPerPersona;
  }

  /** Number of active threads for a persona. */
  activeCount(persona?: string): number {
    if (!persona) return this.active.size;
    let count = 0;
    for (const t of this.active.values()) {
      if (t.persona === persona) count++;
    }
    return count;
  }

  /** Whether a new thread can be spawned for this persona. */
  canAccept(persona: string): boolean {
    return this.activeCount(persona) < this.maxConcurrentPerPersona;
  }

  /**
   * Spawn a new thread with an independent Agent instance.
   * Returns the thread (with its own Agent) or null if at capacity.
   */
  spawn(config: ThreadConfig): Thread | null {
    if (!this.canAccept(config.persona)) return null;

    const threadId = `${config.persona}_${++this.threadCounter}_${Date.now()}`;
    const sessionKey = config.sessionKey || config.persona;

    const agent = new Agent({
      initialState: {
        systemPrompt: config.systemPrompt,
        model: config.model,
        thinkingLevel: "off",
        tools: config.tools,
      },
      convertToLlm: config.convertToLlm,
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
    });

    // Load base session if requested
    if (config.loadSession !== false) {
      const previousMessages = loadPersonaSession(sessionKey);
      if (previousMessages.length > 0) {
        agent.replaceMessages(previousMessages);
      }
    }

    const thread: Thread = {
      id: threadId,
      agent,
      persona: config.persona,
      sessionKey,
      startedAt: Date.now(),
    };

    this.active.set(threadId, thread);
    return thread;
  }

  /** Release a completed thread. */
  release(threadId: string): void {
    this.active.delete(threadId);
  }

  /** Get an active thread by ID. */
  get(threadId: string): Thread | undefined {
    return this.active.get(threadId);
  }

  /** List all active threads. */
  list(): Thread[] {
    return [...this.active.values()];
  }

  /**
   * Persist a message to the persona's shared session file.
   * Uses atomic JSONL append — safe for concurrent threads.
   */
  persistMessage(sessionKey: string, message: Message): void {
    appendPersonaSessionMessage(sessionKey, message);
  }

  /**
   * Run compaction for a persona session if needed.
   * Uses a lock to prevent concurrent compaction on the same session.
   */
  async compactIfNeeded(
    thread: Thread,
    inputTokens: number,
    model: Model<Api>,
    log?: (msg: string) => void,
  ): Promise<boolean> {
    if (!shouldCompact(inputTokens, model.contextWindow)) return false;
    if (this.compactionLocks.has(thread.sessionKey)) {
      log?.(`Compaction skipped — another thread is compacting ${thread.sessionKey}`);
      return false;
    }

    this.compactionLocks.add(thread.sessionKey);
    try {
      log?.(`Compacting session for ${thread.sessionKey}...`);
      const result = await compact(thread.agent, model, log);
      if (result) {
        savePersonaSession(thread.sessionKey, thread.agent.state.messages as Message[]);
        return true;
      }
      return false;
    } finally {
      this.compactionLocks.delete(thread.sessionKey);
    }
  }
}
