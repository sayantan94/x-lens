# x-lens Daemon Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a 24/7 daemon mode where the agent autonomously monitors markets, creates its own schedules, learns from results, and pushes macOS notifications.

**Architecture:** A `x-lens daemon` command starts a long-running Node process. It maintains one persistent Agent session per persona, runs jobs from an agent-managed job store (`~/.x-lens/jobs.json`), and sends macOS notifications via `osascript`. The agent gets 3 new tools (`schedule_create`, `schedule_delete`, `schedule_list`) to manage its own jobs.

**Tech Stack:** TypeScript, node-cron, Node built-in `http` module, macOS `osascript` for notifications.

---

### Task 1: Notification Service

The simplest, most independent component. No dependencies on other new code.

**Files:**
- Create: `app/src/notify.ts`
- Test: `app/src/__tests__/notify.test.ts`

**Step 1: Write the failing test**

```typescript
// app/src/__tests__/notify.test.ts
import { describe, it, expect, vi } from "vitest";
import { exec } from "node:child_process";

vi.mock("node:child_process", () => ({
  exec: vi.fn((_cmd: string, cb: Function) => cb(null, "", "")),
}));

const { notify } = await import("../notify.js");

describe("notify", () => {
  it("should call osascript with title and body", () => {
    notify("NVDA: CALL 72%", "Entry above $143, target $155");
    expect(exec).toHaveBeenCalledOnce();
    const cmd = (exec as any).mock.calls[0][0] as string;
    expect(cmd).toContain("display notification");
    expect(cmd).toContain("NVDA: CALL 72%");
    expect(cmd).toContain("Entry above $143, target $155");
  });

  it("should escape double quotes in title and body", () => {
    notify('Test "quotes"', 'Body "here"');
    const cmd = (exec as any).mock.calls[0][0] as string;
    expect(cmd).not.toContain('""');
    expect(cmd).toContain("display notification");
  });

  it("should include sound name", () => {
    notify("Alert", "Body", "Glass");
    const cmd = (exec as any).mock.calls[0][0] as string;
    expect(cmd).toContain('sound name "Glass"');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && npx vitest run src/__tests__/notify.test.ts`
Expected: FAIL with "Cannot find module '../notify.js'"

**Step 3: Write minimal implementation**

```typescript
// app/src/notify.ts
import { exec } from "node:child_process";

/**
 * Send a macOS notification via osascript.
 */
export function notify(title: string, body: string, sound = "default"): void {
  const escapedTitle = title.replace(/"/g, '\\"');
  const escapedBody = body.replace(/"/g, '\\"');
  const cmd = `osascript -e 'display notification "${escapedBody}" with title "${escapedTitle}" sound name "${sound}"'`;
  exec(cmd, (err) => {
    if (err) {
      console.error(`Notification failed: ${err.message}`);
    }
  });
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && npx vitest run src/__tests__/notify.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add app/src/notify.ts app/src/__tests__/notify.test.ts
git commit -m "feat: add macOS notification service"
```

---

### Task 2: Job Store

Manages reading/writing jobs to `~/.x-lens/jobs.json`. Pure data layer, no scheduling logic.

**Files:**
- Create: `app/src/job-store.ts`
- Test: `app/src/__tests__/job-store.test.ts`

**Step 1: Write the failing test**

```typescript
// app/src/__tests__/job-store.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_HOME = join(tmpdir(), `x-lens-job-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => TEST_HOME };
});

const { JobStore } = await import("../job-store.js");

describe("JobStore", () => {
  let store: InstanceType<typeof JobStore>;

  beforeEach(() => {
    if (!existsSync(TEST_HOME)) mkdirSync(TEST_HOME, { recursive: true });
    store = new JobStore();
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("should return empty array when no jobs file exists", () => {
    expect(store.list()).toEqual([]);
  });

  it("should create and retrieve a cron job", () => {
    const job = store.create({
      id: "test-job",
      persona: "trader",
      prompt: "Run OI scan",
      type: "cron",
      schedule: "30 6 * * 1-5",
      notify: true,
    });
    expect(job.id).toBe("test-job");
    expect(store.list()).toHaveLength(1);
    expect(store.get("test-job")).toEqual(job);
  });

  it("should create an interval job", () => {
    const job = store.create({
      id: "interval-job",
      persona: "predictor",
      prompt: "Check markets",
      type: "interval",
      interval_minutes: 60,
      notify: true,
    });
    expect(job.type).toBe("interval");
    expect(job.interval_minutes).toBe(60);
  });

  it("should create a continuous job", () => {
    const job = store.create({
      id: "continuous-job",
      persona: "predictor",
      prompt: "Monitor BTC arb",
      type: "continuous",
      pause_seconds: 30,
      notify: true,
    });
    expect(job.type).toBe("continuous");
    expect(job.pause_seconds).toBe(30);
  });

  it("should delete a job", () => {
    store.create({
      id: "to-delete",
      persona: "trader",
      prompt: "test",
      type: "cron",
      schedule: "* * * * *",
      notify: false,
    });
    expect(store.list()).toHaveLength(1);
    const deleted = store.delete("to-delete");
    expect(deleted).toBe(true);
    expect(store.list()).toHaveLength(0);
  });

  it("should return false when deleting non-existent job", () => {
    expect(store.delete("nope")).toBe(false);
  });

  it("should update last_run and last_result_summary", () => {
    store.create({
      id: "update-me",
      persona: "trader",
      prompt: "test",
      type: "cron",
      schedule: "* * * * *",
      notify: false,
    });
    const now = new Date().toISOString();
    store.recordRun("update-me", now, "NVDA CALL 72%");
    const job = store.get("update-me")!;
    expect(job.last_run).toBe(now);
    expect(job.last_result_summary).toBe("NVDA CALL 72%");
    expect(job.run_count).toBe(1);
  });

  it("should persist across instances", () => {
    store.create({
      id: "persist-test",
      persona: "trader",
      prompt: "test",
      type: "cron",
      schedule: "* * * * *",
      notify: false,
    });
    const store2 = new JobStore();
    expect(store2.list()).toHaveLength(1);
    expect(store2.get("persist-test")?.prompt).toBe("test");
  });

  it("should reject duplicate job IDs", () => {
    store.create({
      id: "dupe",
      persona: "trader",
      prompt: "test",
      type: "cron",
      schedule: "* * * * *",
      notify: false,
    });
    expect(() => store.create({
      id: "dupe",
      persona: "trader",
      prompt: "test2",
      type: "cron",
      schedule: "* * * * *",
      notify: false,
    })).toThrow(/already exists/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && npx vitest run src/__tests__/job-store.test.ts`
Expected: FAIL with "Cannot find module '../job-store.js'"

**Step 3: Write minimal implementation**

```typescript
// app/src/job-store.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface Job {
  id: string;
  persona: string;
  prompt: string;
  type: "cron" | "interval" | "continuous";
  schedule?: string;          // cron expression (type=cron)
  interval_minutes?: number;  // (type=interval)
  pause_seconds?: number;     // (type=continuous)
  enabled: boolean;
  notify: boolean;
  created_at: string;
  last_run?: string;
  last_result_summary?: string;
  run_count: number;
}

export type CreateJobInput = Omit<Job, "enabled" | "created_at" | "run_count" | "last_run" | "last_result_summary">;

const X_LENS_DIR = join(homedir(), ".x-lens");
const JOBS_FILE = join(X_LENS_DIR, "jobs.json");

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export class JobStore {
  private jobs: Job[] = [];

  constructor() {
    this.load();
  }

  private load(): void {
    ensureDir(X_LENS_DIR);
    if (!existsSync(JOBS_FILE)) {
      this.jobs = [];
      return;
    }
    try {
      const data = JSON.parse(readFileSync(JOBS_FILE, "utf-8"));
      this.jobs = data.jobs ?? [];
    } catch {
      this.jobs = [];
    }
  }

  private save(): void {
    ensureDir(X_LENS_DIR);
    writeFileSync(JOBS_FILE, JSON.stringify({ jobs: this.jobs }, null, 2), "utf-8");
  }

  list(): Job[] {
    return [...this.jobs];
  }

  get(id: string): Job | undefined {
    return this.jobs.find((j) => j.id === id);
  }

  create(input: CreateJobInput): Job {
    if (this.jobs.some((j) => j.id === input.id)) {
      throw new Error(`Job "${input.id}" already exists`);
    }
    const job: Job = {
      ...input,
      enabled: true,
      created_at: new Date().toISOString(),
      run_count: 0,
    };
    this.jobs.push(job);
    this.save();
    return job;
  }

  delete(id: string): boolean {
    const idx = this.jobs.findIndex((j) => j.id === id);
    if (idx === -1) return false;
    this.jobs.splice(idx, 1);
    this.save();
    return true;
  }

  recordRun(id: string, timestamp: string, resultSummary: string): void {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    job.last_run = timestamp;
    job.last_result_summary = resultSummary;
    job.run_count += 1;
    this.save();
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && npx vitest run src/__tests__/job-store.test.ts`
Expected: PASS (8 tests)

**Step 5: Commit**

```bash
git add app/src/job-store.ts app/src/__tests__/job-store.test.ts
git commit -m "feat: add job store for daemon scheduled tasks"
```

---

### Task 3: Session Manager

Manages one persistent Agent per persona. Extends the existing `memory.ts` session pattern to support per-persona session files.

**Files:**
- Create: `app/src/session-manager.ts`
- Test: `app/src/__tests__/session-manager.test.ts`
- Reference: `app/src/memory.ts` (for session persistence patterns)
- Reference: `app/src/repl.ts:85-110` (for Agent initialization pattern)

**Step 1: Write the failing test**

```typescript
// app/src/__tests__/session-manager.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_HOME = join(tmpdir(), `x-lens-session-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => TEST_HOME };
});

const {
  loadPersonaSession,
  appendPersonaSessionMessage,
  savePersonaSession,
  clearPersonaSession,
  getPersonaSessionPath,
} = await import("../session-manager.js");

describe("session-manager", () => {
  beforeEach(() => {
    if (!existsSync(TEST_HOME)) mkdirSync(TEST_HOME, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("should return empty array for new persona", () => {
    expect(loadPersonaSession("trader")).toEqual([]);
  });

  it("should store separate sessions per persona", () => {
    const msg1 = { role: "user" as const, content: [{ type: "text" as const, text: "trader msg" }], timestamp: 1 };
    const msg2 = { role: "user" as const, content: [{ type: "text" as const, text: "predictor msg" }], timestamp: 2 };

    appendPersonaSessionMessage("trader", msg1);
    appendPersonaSessionMessage("predictor", msg2);

    const traderMsgs = loadPersonaSession("trader");
    const predictorMsgs = loadPersonaSession("predictor");

    expect(traderMsgs).toHaveLength(1);
    expect(predictorMsgs).toHaveLength(1);
    expect(traderMsgs[0].content[0].text).toBe("trader msg");
    expect(predictorMsgs[0].content[0].text).toBe("predictor msg");
  });

  it("should save full session (overwrite)", () => {
    appendPersonaSessionMessage("trader", {
      role: "user", content: [{ type: "text", text: "old" }], timestamp: 1,
    });
    savePersonaSession("trader", [
      { role: "user", content: [{ type: "text", text: "new" }], timestamp: 2 },
    ]);
    const loaded = loadPersonaSession("trader");
    expect(loaded).toHaveLength(1);
    expect(loaded[0].content[0].text).toBe("new");
  });

  it("should clear a persona session", () => {
    appendPersonaSessionMessage("trader", {
      role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1,
    });
    clearPersonaSession("trader");
    expect(loadPersonaSession("trader")).toEqual([]);
  });

  it("should return correct path per persona", () => {
    const path = getPersonaSessionPath("trader");
    expect(path).toMatch(/sessions\/trader\.jsonl$/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && npx vitest run src/__tests__/session-manager.test.ts`
Expected: FAIL with "Cannot find module '../session-manager.js'"

**Step 3: Write minimal implementation**

```typescript
// app/src/session-manager.ts
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
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && npx vitest run src/__tests__/session-manager.test.ts`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add app/src/session-manager.ts app/src/__tests__/session-manager.test.ts
git commit -m "feat: add per-persona session manager for daemon"
```

---

### Task 4: Schedule Tools

Add `schedule_create`, `schedule_delete`, `schedule_list` tools to `tools.ts`. These let the agent manage its own jobs.

**Files:**
- Modify: `app/src/tools.ts:329-373`
- Test: `app/src/__tests__/schedule-tools.test.ts`
- Reference: `app/src/job-store.ts` (from Task 2)

**Step 1: Write the failing test**

```typescript
// app/src/__tests__/schedule-tools.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_HOME = join(tmpdir(), `x-lens-sched-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => TEST_HOME };
});

const { JobStore } = await import("../job-store.js");
const { createScheduleTools } = await import("../tools.js");

describe("schedule tools", () => {
  let store: InstanceType<typeof JobStore>;
  let tools: ReturnType<typeof createScheduleTools>;

  beforeEach(() => {
    if (!existsSync(TEST_HOME)) mkdirSync(TEST_HOME, { recursive: true });
    store = new JobStore();
    tools = createScheduleTools(store);
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("should have 3 schedule tools", () => {
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual(["schedule_create", "schedule_delete", "schedule_list"]);
  });

  it("schedule_create should create a job and return confirmation", async () => {
    const tool = tools.find((t) => t.name === "schedule_create")!;
    const result = await tool.execute("call-1", {
      id: "test-job",
      persona: "trader",
      prompt: "Run OI scan",
      type: "cron",
      schedule: "30 6 * * 1-5",
      notify: true,
    });
    const text = (result.content as any[])[0].text;
    expect(text).toContain("test-job");
    expect(text).toContain("created");
    expect(store.list()).toHaveLength(1);
  });

  it("schedule_delete should remove a job", async () => {
    store.create({
      id: "to-delete",
      persona: "trader",
      prompt: "test",
      type: "cron",
      schedule: "* * * * *",
      notify: false,
    });
    const tool = tools.find((t) => t.name === "schedule_delete")!;
    const result = await tool.execute("call-2", { id: "to-delete" });
    const text = (result.content as any[])[0].text;
    expect(text).toContain("deleted");
    expect(store.list()).toHaveLength(0);
  });

  it("schedule_list should show all jobs", async () => {
    store.create({
      id: "job-1",
      persona: "trader",
      prompt: "test",
      type: "cron",
      schedule: "* * * * *",
      notify: false,
    });
    const tool = tools.find((t) => t.name === "schedule_list")!;
    const result = await tool.execute("call-3", {});
    const text = (result.content as any[])[0].text;
    expect(text).toContain("job-1");
    expect(text).toContain("trader");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && npx vitest run src/__tests__/schedule-tools.test.ts`
Expected: FAIL with "createScheduleTools is not a function" or similar

**Step 3: Add schedule tools to tools.ts**

Add the following to `app/src/tools.ts` — insert before the `createTools` export function (before line 357):

```typescript
import { JobStore, type CreateJobInput } from "./job-store.js";

function createScheduleCreateTool(store: JobStore): AgentTool {
  return {
    name: "schedule_create",
    label: "Create Schedule",
    description:
      "Create a scheduled job that runs automatically. Types: 'cron' (cron expression), 'interval' (every N minutes), 'continuous' (loop with pause). The job runs in the daemon using the specified persona's agent session.",
    parameters: Type.Object({
      id: Type.String({ description: "Unique job ID (e.g., 'oi-morning-scan')" }),
      persona: Type.String({ description: "Persona to use (e.g., 'trader', 'predictor')" }),
      prompt: Type.String({ description: "What to do each run (natural language instruction)" }),
      type: Type.Union([Type.Literal("cron"), Type.Literal("interval"), Type.Literal("continuous")], {
        description: "Job type: cron, interval, or continuous",
      }),
      schedule: Type.Optional(Type.String({ description: "Cron expression (for type=cron, e.g., '30 6 * * 1-5')" })),
      interval_minutes: Type.Optional(Type.Number({ description: "Run every N minutes (for type=interval)" })),
      pause_seconds: Type.Optional(Type.Number({ description: "Pause between loops in seconds (for type=continuous, default: 30)" })),
      notify: Type.Boolean({ description: "Send macOS notification with results" }),
    }),
    execute: async (_toolCallId, params: any) => {
      try {
        const job = store.create(params as CreateJobInput);
        return textResult(`Schedule "${job.id}" created (type: ${job.type}, persona: ${job.persona}). It will start running when the daemon is active.`);
      } catch (err: any) {
        return textResult(`Failed to create schedule: ${err.message}`);
      }
    },
  };
}

function createScheduleDeleteTool(store: JobStore): AgentTool {
  return {
    name: "schedule_delete",
    label: "Delete Schedule",
    description: "Delete a scheduled job by ID. The job will stop running.",
    parameters: Type.Object({
      id: Type.String({ description: "Job ID to delete" }),
    }),
    execute: async (_toolCallId, params: any) => {
      const deleted = store.delete(params.id);
      if (deleted) {
        return textResult(`Schedule "${params.id}" deleted.`);
      }
      return textResult(`Schedule "${params.id}" not found.`);
    },
  };
}

function createScheduleListTool(store: JobStore): AgentTool {
  return {
    name: "schedule_list",
    label: "List Schedules",
    description: "List all scheduled jobs with their status, last run time, and results.",
    parameters: Type.Object({}),
    execute: async () => {
      const jobs = store.list();
      if (jobs.length === 0) {
        return textResult("No scheduled jobs.");
      }
      const lines = jobs.map((j) => {
        const schedule = j.type === "cron" ? j.schedule :
          j.type === "interval" ? `every ${j.interval_minutes}min` :
          `continuous (${j.pause_seconds}s pause)`;
        const lastRun = j.last_run ? `last: ${j.last_run}` : "never run";
        const result = j.last_result_summary ? ` → ${j.last_result_summary}` : "";
        return `- ${j.id} [${j.persona}] ${j.type}: ${schedule} | ${lastRun}${result} | runs: ${j.run_count} | notify: ${j.notify}`;
      });
      return textResult(`Scheduled jobs (${jobs.length}):\n${lines.join("\n")}`);
    },
  };
}

export function createScheduleTools(store: JobStore): AgentTool[] {
  return [
    createScheduleCreateTool(store),
    createScheduleDeleteTool(store),
    createScheduleListTool(store),
  ];
}
```

Then update the `createTools` export to accept an optional `JobStore` and include schedule tools:

```typescript
// Replace the existing createTools function (line 357-373)
export function createTools(browser: BrowserController, skills: Skill[], jobStore?: JobStore): AgentTool[] {
  const tools = [
    createNavigateTool(browser),
    createScreenshotTool(browser),
    createClickTool(browser),
    createTypeTool(browser),
    createScrollTool(browser),
    createEvaluateTool(browser),
    createWebSearchTool(browser),
    createShellTool(),
    createFetchTool(),
    createMemoryReadTool(),
    createMemoryWriteTool(),
    createMemoryAppendTool(),
    createSkillReadTool(skills),
  ];
  if (jobStore) {
    tools.push(...createScheduleTools(jobStore));
  }
  return tools;
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && npx vitest run src/__tests__/schedule-tools.test.ts`
Expected: PASS (4 tests)

**Step 5: Run all existing tests to make sure nothing broke**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && npx vitest run`
Expected: All tests PASS (createTools signature is backward-compatible since jobStore is optional)

**Step 6: Commit**

```bash
git add app/src/tools.ts app/src/__tests__/schedule-tools.test.ts
git commit -m "feat: add schedule_create/delete/list agent tools"
```

---

### Task 5: Daemon Process

The main daemon — ties together JobStore, SessionManager, Agent, notification, and scheduling.

**Files:**
- Create: `app/src/daemon.ts`
- Reference: `app/src/repl.ts` (for Agent init, event subscription, compaction patterns)
- Reference: `app/src/runner.ts` (for `resolveModel`, `buildSystemPrompt`, `convertToLlm`)
- Reference: `app/src/job-store.ts` (from Task 2)
- Reference: `app/src/session-manager.ts` (from Task 3)
- Reference: `app/src/notify.ts` (from Task 1)

**Step 1: Install node-cron**

```bash
cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && npm install node-cron && npm install -D @types/node-cron
```

**Step 2: Write the daemon**

```typescript
// app/src/daemon.ts
import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import { getModel, type Message, type Model, type Api } from "@mariozechner/pi-ai";
import cron from "node-cron";
import chalk from "chalk";
import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { BrowserController } from "./browser.js";
import { createTools } from "./tools.js";
import { loadSkills, formatSkillsForPrompt } from "./skills.js";
import { readMemory } from "./memory.js";
import { JobStore, type Job } from "./job-store.js";
import {
  loadPersonaSession,
  appendPersonaSessionMessage,
  savePersonaSession,
} from "./session-manager.js";
import { notify } from "./notify.js";
import { shouldCompact, compact } from "./compaction.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const X_LENS_DIR = join(homedir(), ".x-lens");
const PID_FILE = join(X_LENS_DIR, "daemon.pid");
const LOG_FILE = join(X_LENS_DIR, "daemon.log");

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}`;
  console.log(line);
  ensureDir(X_LENS_DIR);
  appendFileSync(LOG_FILE, line + "\n", "utf-8");
}

function logError(msg: string): void {
  log(`ERROR: ${msg}`);
}

// ---------------------------------------------------------------------------
// System prompt (same as repl.ts but with daemon context)
// ---------------------------------------------------------------------------

function buildDaemonSystemPrompt(
  skills: ReturnType<typeof loadSkills>,
  memory: string,
  persona: string,
): string {
  const skillsSection = formatSkillsForPrompt(skills);

  return `You are x-lens, a personal AI agent running as a 24/7 daemon.

You are currently operating as the "${persona}" persona in autonomous mode.
You are executing a scheduled task. Analyze the results and decide:
1. Whether to notify the user (only for actionable findings)
2. What to save to memory for future reference
3. Whether to adjust your monitoring approach

You have access to a browser, shell, fetch, and memory tools.

IMPORTANT — Skill Usage Protocol:
1. BEFORE doing anything, scan the Available Skills list below for a match
2. If ANY skill matches, call skill_read to load its full instructions FIRST
3. Follow the skill's instructions exactly
4. Only use general capabilities if NO skill matches

You also have schedule management tools:
- schedule_create: Create new scheduled jobs
- schedule_delete: Remove scheduled jobs
- schedule_list: List all active jobs

When you find something actionable, include a clear summary suitable for a notification.
Format actionable findings as: [ALERT] <title> | <details>

## Your Memory
${memory}

${skillsSection}`;
}

// ---------------------------------------------------------------------------
// Persona Agent Manager
// ---------------------------------------------------------------------------

interface PersonaAgent {
  agent: Agent;
  browser: BrowserController;
  busy: boolean;
  lastInputTokens: number;
}

const personaAgents = new Map<string, PersonaAgent>();

function resolveModel(provider: string, modelId?: string): Model<Api> {
  if (provider === "anthropic") {
    return getModel("anthropic", (modelId || "claude-sonnet-4-20250514") as any);
  }
  return getModel("amazon-bedrock", (modelId || "anthropic.claude-sonnet-4-20250514-v1:0") as any);
}

function convertToLlm(messages: Message[]): Message[] {
  return messages.filter(
    (m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult",
  );
}

function getOrCreatePersonaAgent(
  persona: string,
  jobStore: JobStore,
  projectRoot: string,
  provider: string,
  modelId?: string,
): PersonaAgent {
  const existing = personaAgents.get(persona);
  if (existing) return existing;

  const browser = new BrowserController({ headless: true });
  const skills = loadSkills(projectRoot, persona);
  const tools = createTools(browser, skills, jobStore);
  const model = resolveModel(provider, modelId);
  const memory = readMemory();

  const agent = new Agent({
    initialState: {
      systemPrompt: buildDaemonSystemPrompt(skills, memory, persona),
      model,
      thinkingLevel: "off",
      tools,
    },
    convertToLlm,
    steeringMode: "one-at-a-time",
    followUpMode: "one-at-a-time",
  });

  // Restore persona session
  const previousMessages = loadPersonaSession(persona);
  if (previousMessages.length > 0) {
    agent.replaceMessages(previousMessages);
    log(`[${persona}] Restored ${previousMessages.length} messages from session`);
  }

  const pa: PersonaAgent = { agent, browser, busy: false, lastInputTokens: 0 };
  personaAgents.set(persona, pa);
  return pa;
}

// ---------------------------------------------------------------------------
// Job Execution
// ---------------------------------------------------------------------------

async function executeJob(
  job: Job,
  jobStore: JobStore,
  projectRoot: string,
  provider: string,
  modelId?: string,
): Promise<void> {
  const pa = getOrCreatePersonaAgent(job.persona, jobStore, projectRoot, provider, modelId);

  if (pa.busy) {
    log(`[${job.persona}] Skipping job "${job.id}" — agent is busy`);
    return;
  }

  pa.busy = true;
  log(`[${job.persona}] Running job "${job.id}": ${job.prompt}`);

  let responseText = "";
  let hasError = false;

  // One-shot event collector for this run
  const unsubscribe = pa.agent.subscribe((event: AgentEvent) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      responseText += event.assistantMessageEvent.delta;
    }

    if (event.type === "message_end") {
      appendPersonaSessionMessage(job.persona, event.message as Message);
      const msg = event.message as any;
      if (msg.role === "assistant" && msg.usage) {
        pa.lastInputTokens = msg.usage.input + (msg.usage.cacheRead || 0);
      }
    }

    if (event.type === "agent_end") {
      if (event.messages?.length) {
        for (const msg of event.messages) {
          const errorMsg = (msg as any).errorMessage;
          if (errorMsg) {
            logError(`[${job.persona}] Job "${job.id}" error: ${errorMsg}`);
            hasError = true;
          }
        }
      }
    }
  });

  try {
    const userMessage: Message = {
      role: "user",
      content: [{ type: "text", text: `[Scheduled task: ${job.id}] ${job.prompt}` }],
      timestamp: Date.now(),
    };

    await pa.agent.prompt(userMessage);
    await pa.agent.waitForIdle();

    // Record run
    const summary = responseText.slice(0, 200);
    jobStore.recordRun(job.id, new Date().toISOString(), summary);

    // Check for [ALERT] markers in response — send notification
    if (job.notify && responseText) {
      const alertMatch = responseText.match(/\[ALERT\]\s*(.+?)(?:\n|$)/);
      if (alertMatch) {
        const alertParts = alertMatch[1].split("|").map((s) => s.trim());
        const title = `[${job.persona.toUpperCase()}] ${alertParts[0]}`;
        const body = alertParts[1] || summary;
        notify(title, body);
        log(`[${job.persona}] Notification sent: ${title}`);
      }
    }

    // Compact if needed
    const model = resolveModel(provider, modelId);
    if (shouldCompact(pa.lastInputTokens, model.contextWindow)) {
      log(`[${job.persona}] Compacting session...`);
      const result = await compact(pa.agent, model, (msg) => log(`[${job.persona}] ${msg}`));
      if (result) {
        savePersonaSession(job.persona, pa.agent.state.messages as Message[]);
      }
    }

    if (!hasError) {
      log(`[${job.persona}] Job "${job.id}" completed. Summary: ${summary}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError(`[${job.persona}] Job "${job.id}" failed: ${msg}`);
    if (job.notify) {
      notify(`[${job.persona.toUpperCase()}] Job Failed`, `${job.id}: ${msg}`, "Basso");
    }
  } finally {
    unsubscribe();
    responseText = "";
    pa.busy = false;
  }
}

// ---------------------------------------------------------------------------
// Daemon Runner
// ---------------------------------------------------------------------------

export async function startDaemon(options: {
  provider?: string;
  model?: string;
} = {}): Promise<void> {
  const provider = options.provider || process.env.X_LENS_PROVIDER || "bedrock";
  const modelId = options.model;
  const projectRoot = new URL("../..", import.meta.url).pathname;
  const jobStore = new JobStore();

  ensureDir(X_LENS_DIR);

  // Write PID file
  writeFileSync(PID_FILE, String(process.pid), "utf-8");

  log("=== x-lens daemon starting ===");
  log(`Provider: ${provider}, PID: ${process.pid}`);

  const jobs = jobStore.list();
  log(`Loaded ${jobs.length} jobs from store`);

  // Track active cron tasks and intervals for cleanup
  const cronTasks: cron.ScheduledTask[] = [];
  const intervals: NodeJS.Timeout[] = [];

  function scheduleJobs(): void {
    // Clear existing schedules
    for (const task of cronTasks) task.stop();
    cronTasks.length = 0;
    for (const iv of intervals) clearInterval(iv);
    intervals.length = 0;

    const currentJobs = jobStore.list().filter((j) => j.enabled);

    for (const job of currentJobs) {
      if (job.type === "cron" && job.schedule) {
        if (!cron.validate(job.schedule)) {
          logError(`Invalid cron expression for job "${job.id}": ${job.schedule}`);
          continue;
        }
        const task = cron.schedule(job.schedule, () => {
          executeJob(job, jobStore, projectRoot, provider, modelId);
        });
        cronTasks.push(task);
        log(`Scheduled cron job "${job.id}": ${job.schedule}`);
      } else if (job.type === "interval" && job.interval_minutes) {
        const ms = job.interval_minutes * 60 * 1000;
        // Run immediately on start, then at interval
        executeJob(job, jobStore, projectRoot, provider, modelId);
        const iv = setInterval(() => {
          executeJob(job, jobStore, projectRoot, provider, modelId);
        }, ms);
        intervals.push(iv);
        log(`Scheduled interval job "${job.id}": every ${job.interval_minutes}min`);
      } else if (job.type === "continuous") {
        const pauseMs = (job.pause_seconds ?? 30) * 1000;
        async function loop() {
          while (true) {
            const currentJob = jobStore.get(job.id);
            if (!currentJob || !currentJob.enabled) break;
            await executeJob(currentJob, jobStore, projectRoot, provider, modelId);
            await new Promise((r) => setTimeout(r, pauseMs));
          }
          log(`Continuous job "${job.id}" stopped`);
        }
        loop();
        log(`Started continuous job "${job.id}": ${job.pause_seconds ?? 30}s pause`);
      }
    }
  }

  // Initial schedule
  scheduleJobs();

  // Re-read jobs every 60 seconds to pick up agent-created schedules
  setInterval(() => {
    const newJobs = jobStore.list();
    const currentCount = cronTasks.length + intervals.length;
    if (newJobs.filter((j) => j.enabled).length !== currentCount) {
      log("Job store changed — rescheduling...");
      scheduleJobs();
    }
  }, 60_000);

  // Graceful shutdown
  const shutdown = async () => {
    log("=== x-lens daemon shutting down ===");
    for (const task of cronTasks) task.stop();
    for (const iv of intervals) clearInterval(iv);

    // Close all browsers
    for (const [persona, pa] of personaAgents) {
      try {
        await pa.browser.close();
        log(`[${persona}] Browser closed`);
      } catch { /* ignore */ }
    }

    // Remove PID file
    try { unlinkSync(PID_FILE); } catch { /* ignore */ }
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // Handle uncaught errors (don't crash the daemon)
  process.on("uncaughtException", (err) => {
    logError(`Uncaught exception: ${err.message}`);
  });
  process.on("unhandledRejection", (reason) => {
    logError(`Unhandled rejection: ${reason}`);
  });

  log("Daemon running. Press Ctrl+C to stop.");

  // Keep process alive
  await new Promise(() => {});
}

// ---------------------------------------------------------------------------
// Daemon Management
// ---------------------------------------------------------------------------

export function getDaemonPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    // Check if process is actually running
    try {
      process.kill(pid, 0);
      return pid;
    } catch {
      // Process not running, clean up stale PID file
      unlinkSync(PID_FILE);
      return null;
    }
  } catch {
    return null;
  }
}

export function stopDaemon(): boolean {
  const pid = getDaemonPid();
  if (!pid) return false;
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

export function daemonStatus(): { running: boolean; pid?: number; jobs: Job[] } {
  const pid = getDaemonPid();
  const store = new JobStore();
  return {
    running: pid !== null,
    pid: pid ?? undefined,
    jobs: store.list(),
  };
}
```

**Step 3: Commit**

```bash
git add app/src/daemon.ts
git commit -m "feat: add daemon process with cron/interval/continuous job execution"
```

---

### Task 6: CLI Commands

Add `x-lens daemon start|stop|status|install|uninstall|logs` subcommands to `main.ts`.

**Files:**
- Modify: `app/src/main.ts`

**Step 1: Update main.ts**

Replace the entire `app/src/main.ts` with:

```typescript
#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config({ path: new URL("../../.env", import.meta.url).pathname });

import { Command } from "commander";

const program = new Command();

program
  .name("x-lens")
  .description("Skills-based personal agent with browser capabilities")
  .version("0.1.0")
  .argument("[prompt]", "Task to execute (command mode)")
  .option("--visible", "Show browser window (default: headless)")
  .option("--model <model>", "Override model ID")
  .option(
    "--provider <provider>",
    "AI provider (bedrock or anthropic)",
    process.env.X_LENS_PROVIDER || "bedrock",
  )
  .option("--persona <persona>", "Persona to use (e.g., trader)")
  .option("--new", "Start a new session (clear conversation history)")
  .action(async (prompt, options) => {
    if (prompt) {
      const { runOnce } = await import("./runner.js");
      await runOnce(prompt, options);
    } else {
      const { runInteractive } = await import("./repl.js");
      await runInteractive(options);
    }
  });

// Daemon subcommand
const daemon = program.command("daemon").description("Manage the x-lens background daemon");

daemon
  .command("start")
  .description("Start the daemon (foreground)")
  .option("--provider <provider>", "AI provider", process.env.X_LENS_PROVIDER || "bedrock")
  .option("--model <model>", "Override model ID")
  .action(async (options) => {
    const { startDaemon } = await import("./daemon.js");
    await startDaemon(options);
  });

daemon
  .command("stop")
  .description("Stop the running daemon")
  .action(async () => {
    const { stopDaemon } = await import("./daemon.js");
    const stopped = stopDaemon();
    if (stopped) {
      console.log("Daemon stopped.");
    } else {
      console.log("No daemon running.");
    }
  });

daemon
  .command("status")
  .description("Show daemon status and active jobs")
  .action(async () => {
    const { daemonStatus } = await import("./daemon.js");
    const status = daemonStatus();
    if (status.running) {
      console.log(`Daemon running (PID: ${status.pid})`);
    } else {
      console.log("Daemon not running.");
    }
    if (status.jobs.length === 0) {
      console.log("No scheduled jobs.");
    } else {
      console.log(`\nJobs (${status.jobs.length}):`);
      for (const job of status.jobs) {
        const schedule = job.type === "cron" ? job.schedule :
          job.type === "interval" ? `every ${job.interval_minutes}min` :
          `continuous (${job.pause_seconds}s pause)`;
        const lastRun = job.last_run ?? "never";
        const result = job.last_result_summary ? ` → ${job.last_result_summary.slice(0, 80)}` : "";
        console.log(`  ${job.enabled ? "●" : "○"} ${job.id} [${job.persona}] ${schedule} | last: ${lastRun}${result} | runs: ${job.run_count}`);
      }
    }
  });

daemon
  .command("install")
  .description("Install daemon as macOS launchd service (auto-start on boot)")
  .action(async () => {
    const { existsSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    const { execSync } = await import("node:child_process");

    const launchAgentsDir = join(homedir(), "Library", "LaunchAgents");
    const plistPath = join(launchAgentsDir, "com.x-lens.daemon.plist");
    const logPath = join(homedir(), ".x-lens", "daemon.log");

    // Find the x-lens binary
    let binPath: string;
    try {
      binPath = execSync("which x-lens", { encoding: "utf-8" }).trim();
    } catch {
      console.error("x-lens not found in PATH. Run 'cd app && npm link' first.");
      process.exit(1);
    }

    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.x-lens.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>${binPath}</string>
        <string>daemon</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${logPath}</string>
    <key>StandardErrorPath</key>
    <string>${logPath}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>`;

    if (!existsSync(launchAgentsDir)) {
      const { mkdirSync } = await import("node:fs");
      mkdirSync(launchAgentsDir, { recursive: true });
    }

    writeFileSync(plistPath, plist, "utf-8");
    execSync(`launchctl load "${plistPath}"`);
    console.log(`Daemon installed at ${plistPath}`);
    console.log("It will start now and auto-restart on boot.");
  });

daemon
  .command("uninstall")
  .description("Remove daemon from launchd (stop auto-start)")
  .action(async () => {
    const { existsSync, unlinkSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    const { execSync } = await import("node:child_process");

    const plistPath = join(homedir(), "Library", "LaunchAgents", "com.x-lens.daemon.plist");
    if (!existsSync(plistPath)) {
      console.log("Daemon not installed.");
      return;
    }

    try { execSync(`launchctl unload "${plistPath}"`); } catch { /* ignore */ }
    unlinkSync(plistPath);
    console.log("Daemon uninstalled.");
  });

daemon
  .command("logs")
  .description("Tail daemon logs")
  .option("-n <lines>", "Number of lines to show", "50")
  .action(async (options) => {
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    const { spawn } = await import("node:child_process");

    const logPath = join(homedir(), ".x-lens", "daemon.log");
    const tail = spawn("tail", ["-f", "-n", options.n, logPath], { stdio: "inherit" });
    tail.on("error", () => {
      console.error("No daemon log found. Start the daemon first.");
    });
  });

program.parse();
```

**Step 2: Verify build succeeds**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && npm run build`
Expected: Build succeeds with no errors

**Step 3: Verify CLI help shows daemon commands**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && node dist/main.js daemon --help`
Expected: Shows start, stop, status, install, uninstall, logs subcommands

**Step 4: Commit**

```bash
git add app/src/main.ts
git commit -m "feat: add daemon CLI commands (start/stop/status/install/uninstall/logs)"
```

---

### Task 7: Wire Schedule Tools into REPL and Runner

Pass the JobStore to `createTools` in `repl.ts` and `runner.ts` so the agent can create schedules from interactive sessions too.

**Files:**
- Modify: `app/src/repl.ts:87-89`
- Modify: `app/src/runner.ts:72-74`

**Step 1: Update repl.ts**

At the top of `runInteractive`, add JobStore import and pass it to createTools:

```typescript
// Add to imports at top of repl.ts (after line 9)
import { JobStore } from "./job-store.js";

// Replace line 89:
//   const tools = createTools(browser, skills);
// With:
  const jobStore = new JobStore();
  const tools = createTools(browser, skills, jobStore);
```

**Step 2: Update runner.ts**

Same change in `runOnce`:

```typescript
// Add to imports at top of runner.ts (after line 8)
import { JobStore } from "./job-store.js";

// Replace line 74:
//   const tools = createTools(browser, skills);
// With:
  const jobStore = new JobStore();
  const tools = createTools(browser, skills, jobStore);
```

**Step 3: Build and verify**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && npm run build`
Expected: Build succeeds

**Step 4: Run all tests**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add app/src/repl.ts app/src/runner.ts
git commit -m "feat: wire schedule tools into REPL and runner modes"
```

---

### Task 8: Add node-cron dependency and build

**Files:**
- Modify: `app/package.json`

**Step 1: Install dependency**

```bash
cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && npm install node-cron && npm install -D @types/node-cron
```

**Step 2: Full build**

```bash
cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens && npm run build
```
Expected: Build succeeds

**Step 3: Run all tests**

```bash
cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && npx vitest run
```
Expected: All tests PASS

**Step 4: Commit**

```bash
git add app/package.json package-lock.json
git commit -m "chore: add node-cron dependency for daemon scheduling"
```

---

### Task 9: Manual Integration Test

Test the full flow end-to-end.

**Step 1: Start daemon in foreground**

```bash
x-lens daemon start --provider anthropic
```
Expected: "x-lens daemon starting", "Loaded 0 jobs"

**Step 2: In another terminal, create a job via REPL**

```bash
x-lens --persona trader
> set up a test job that checks the current time every 2 minutes
```
Expected: Agent calls `schedule_create` tool, job appears in `~/.x-lens/jobs.json`

**Step 3: Check daemon status**

```bash
x-lens daemon status
```
Expected: Shows daemon running, lists the job

**Step 4: Wait for job to execute**

Watch daemon logs:
```bash
x-lens daemon logs
```
Expected: After 2 minutes, see job execution log, notification on macOS

**Step 5: Stop daemon**

```bash
x-lens daemon stop
```
Expected: "Daemon stopped."

**Step 6: Clean up test job**

```bash
rm ~/.x-lens/jobs.json
```
