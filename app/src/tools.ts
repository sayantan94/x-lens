import { Type, type Static } from "@sinclair/typebox";
import type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@mariozechner/pi-agent-core";
import type { TextContent, ImageContent } from "@mariozechner/pi-ai";
import type { BrowserController } from "./browser.js";
import type { Skill } from "./skills.js";
import { exec } from "node:child_process";
import { JobStore, type CreateJobInput } from "./job-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Max text size for tool results (~12K tokens). Prevents context overflow from huge pages. */
const MAX_TEXT_CHARS = 50_000;

function truncateText(text: string, limit = MAX_TEXT_CHARS): string {
  if (text.length <= limit) return text;
  const kept = text.slice(0, limit);
  const dropped = text.length - limit;
  return `${kept}\n\n[...truncated ${dropped} characters]`;
}

async function browserResult(
  browser: BrowserController,
): Promise<(TextContent | ImageContent)[]> {
  const snap = await browser.snapshot();
  const tree = truncateText(snap.accessibilityTree, 30_000);
  return [
    {
      type: "image" as const,
      data: snap.screenshot.toString("base64"),
      mimeType: "image/png",
    },
    {
      type: "text" as const,
      text: `URL: ${snap.url}\nTitle: ${snap.title}\n\nAccessibility Tree:\n${tree}`,
    },
  ];
}

function textResult(text: string): AgentToolResult<void> {
  return {
    content: [{ type: "text", text: truncateText(text) }],
    details: undefined,
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

function createNavigateTool(browser: BrowserController): AgentTool {
  return {
    name: "browser_navigate",
    label: "Navigate Browser",
    description:
      "Navigate the browser to a URL. Returns a screenshot and accessibility tree of the loaded page.",
    parameters: Type.Object({
      url: Type.String({ description: "The URL to navigate to" }),
    }),
    execute: async (_toolCallId, params: any) => {
      await browser.launch();
      await browser.navigate(params.url);
      return { content: await browserResult(browser), details: undefined };
    },
  };
}

function createScreenshotTool(browser: BrowserController): AgentTool {
  return {
    name: "browser_screenshot",
    label: "Browser Screenshot",
    description:
      "Take a screenshot of the current page. Returns the screenshot and accessibility tree.",
    parameters: Type.Object({}),
    execute: async () => {
      return { content: await browserResult(browser), details: undefined };
    },
  };
}

function createClickTool(browser: BrowserController): AgentTool {
  return {
    name: "browser_click",
    label: "Click Element",
    description:
      "Click an element on the page using a CSS selector. Returns a screenshot after clicking.",
    parameters: Type.Object({
      selector: Type.String({
        description: "CSS selector of the element to click",
      }),
    }),
    execute: async (_toolCallId, params: any) => {
      await browser.click(params.selector);
      return { content: await browserResult(browser), details: undefined };
    },
  };
}

function createTypeTool(browser: BrowserController): AgentTool {
  return {
    name: "browser_type",
    label: "Type Text",
    description:
      "Type text into an input element identified by CSS selector. Optionally press Enter to submit. Returns a screenshot after typing.",
    parameters: Type.Object({
      selector: Type.String({
        description: "CSS selector of the input element",
      }),
      text: Type.String({ description: "Text to type into the element" }),
      submit: Type.Optional(
        Type.Boolean({
          description: "If true, press Enter after typing to submit",
          default: false,
        }),
      ),
    }),
    execute: async (_toolCallId, params: any) => {
      await browser.type(params.selector, params.text);
      if (params.submit) {
        await browser.press("Enter");
      }
      return { content: await browserResult(browser), details: undefined };
    },
  };
}

function createScrollTool(browser: BrowserController): AgentTool {
  return {
    name: "browser_scroll",
    label: "Scroll Page",
    description:
      "Scroll the page up or down by a given amount in pixels. Returns a screenshot after scrolling.",
    parameters: Type.Object({
      direction: Type.Union([Type.Literal("up"), Type.Literal("down")], {
        description: 'Scroll direction: "up" or "down"',
      }),
      amount: Type.Optional(
        Type.Number({
          description: "Number of pixels to scroll (default: 500)",
          default: 500,
        }),
      ),
    }),
    execute: async (_toolCallId, params: any) => {
      await browser.scroll(params.direction, params.amount);
      return { content: await browserResult(browser), details: undefined };
    },
  };
}

function createEvaluateTool(browser: BrowserController): AgentTool {
  return {
    name: "browser_evaluate",
    label: "Evaluate JavaScript",
    description:
      "Execute JavaScript code in the browser page context. Returns the result as a string.",
    parameters: Type.Object({
      expression: Type.String({
        description: "JavaScript expression or function body to evaluate",
      }),
    }),
    execute: async (_toolCallId, params: any) => {
      const result = await browser.evaluate(params.expression);
      return textResult(
        typeof result === "string" ? result : JSON.stringify(result, null, 2),
      );
    },
  };
}

function createShellTool(): AgentTool {
  return {
    name: "shell",
    label: "Shell Command",
    description:
      "Execute a shell command and return stdout and stderr. Use for file operations, git, and other CLI tasks.",
    parameters: Type.Object({
      command: Type.String({ description: "The shell command to execute" }),
      timeout: Type.Optional(
        Type.Number({
          description: "Timeout in milliseconds (default: 30000)",
          default: 30000,
        }),
      ),
    }),
    execute: async (_toolCallId, params: any, signal) => {
      return new Promise<AgentToolResult<void>>((resolve) => {
        const timeout = params.timeout ?? 30000;
        const child = exec(params.command, { timeout }, (error, stdout, stderr) => {
          const parts: string[] = [];
          if (stdout) parts.push(`stdout:\n${stdout}`);
          if (stderr) parts.push(`stderr:\n${stderr}`);
          if (error && !stdout && !stderr) {
            parts.push(`error: ${error.message}`);
          }
          resolve(textResult(parts.join("\n\n") || "(no output)"));
        });

        signal?.addEventListener("abort", () => {
          child.kill();
        });
      });
    },
  };
}

function createMemoryReadTool(): AgentTool {
  return {
    name: "memory_read",
    label: "Read Memory",
    description:
      "Read your persistent memory file. Use this to recall information saved across sessions.",
    parameters: Type.Object({}),
    execute: async () => {
      const { readMemory } = await import("./memory.js");
      return textResult(readMemory());
    },
  };
}

function createMemoryWriteTool(): AgentTool {
  return {
    name: "memory_write",
    label: "Write Memory",
    description:
      "Save information to persistent memory. This survives across sessions. Use for preferences, important context, or things to remember.",
    parameters: Type.Object({
      content: Type.String({ description: "Content to write (replaces existing memory)" }),
    }),
    execute: async (_toolCallId, params: any) => {
      const { writeMemory } = await import("./memory.js");
      writeMemory(params.content);
      return textResult("Memory updated successfully.");
    },
  };
}

function createMemoryAppendTool(): AgentTool {
  return {
    name: "memory_append",
    label: "Append Memory",
    description:
      "Append information to persistent memory without replacing existing content.",
    parameters: Type.Object({
      content: Type.String({ description: "Content to append to memory" }),
    }),
    execute: async (_toolCallId, params: any) => {
      const { appendMemory } = await import("./memory.js");
      appendMemory(params.content);
      return textResult("Appended to memory successfully.");
    },
  };
}

function createWebSearchTool(browser: BrowserController): AgentTool {
  return {
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web using Google. Returns search results with titles, URLs, and snippets. Use this instead of manually navigating to Google.",
    parameters: Type.Object({
      query: Type.String({ description: "The search query" }),
    }),
    execute: async (_toolCallId, params: any) => {
      await browser.launch();
      const encodedQuery = encodeURIComponent(params.query);
      await browser.navigate(`https://www.google.com/search?q=${encodedQuery}`);
      // Wait briefly for results to load
      await new Promise((r) => setTimeout(r, 1500));
      return { content: await browserResult(browser), details: undefined };
    },
  };
}

function createFetchTool(): AgentTool {
  return {
    name: "fetch",
    label: "HTTP Fetch",
    description:
      "Make an HTTP request and return the response. Supports GET, POST, PUT, PATCH, DELETE methods.",
    parameters: Type.Object({
      url: Type.String({ description: "The URL to fetch" }),
      method: Type.Optional(
        Type.String({
          description: "HTTP method (default: GET)",
          default: "GET",
        }),
      ),
      headers: Type.Optional(
        Type.Record(Type.String(), Type.String(), {
          description: "HTTP headers as key-value pairs",
        }),
      ),
      body: Type.Optional(
        Type.String({ description: "Request body (for POST/PUT/PATCH)" }),
      ),
    }),
    execute: async (_toolCallId, params: any, signal) => {
      try {
        const response = await globalThis.fetch(params.url, {
          method: params.method ?? "GET",
          headers: params.headers,
          body: params.body,
          signal,
        });

        const contentType = response.headers.get("content-type") ?? "";
        const responseText = await response.text();

        const statusLine = `${response.status} ${response.statusText}`;
        const headerEntries = [...response.headers.entries()]
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n");

        return textResult(
          `Status: ${statusLine}\n\nHeaders:\n${headerEntries}\n\nBody:\n${responseText}`,
        );
      } catch (err: any) {
        return textResult(`Fetch error: ${err.message}`);
      }
    },
  };
}

function createSkillReadTool(skills: Skill[]): AgentTool {
  const skillMap = new Map(skills.map((s) => [s.name, s]));
  return {
    name: "skill_read",
    label: "Read Skill",
    description:
      "Load the full instructions for a skill by name. Use this before following a skill's workflow. Returns the complete skill instructions, scripts directory, and any references.",
    parameters: Type.Object({
      name: Type.String({ description: "The skill name to load (e.g., 'canslim-screener')" }),
    }),
    execute: async (_toolCallId, params: any) => {
      const skill = skillMap.get(params.name);
      if (!skill) {
        const available = [...skillMap.keys()].join(", ");
        return textResult(`Skill "${params.name}" not found. Available skills: ${available}`);
      }
      const parts = [`# ${skill.name}`, `${skill.description}`, ""];
      if (skill.baseDir) parts.push(`Scripts directory: ${skill.baseDir}`, "");
      parts.push(skill.instructions);
      return textResult(parts.join("\n"));
    },
  };
}

// ---------------------------------------------------------------------------
// Schedule tools
// ---------------------------------------------------------------------------

function createScheduleCreateTool(store: JobStore, persona?: string): AgentTool {
  return {
    name: "schedule_create",
    label: "Create Schedule",
    description:
      "Create a scheduled job that runs automatically. Types: 'cron' (cron expression), 'interval' (every N minutes), 'continuous' (loop with pause). The job runs in the daemon using the specified persona's agent session.",
    parameters: Type.Object({
      id: Type.String({ description: "Unique job ID (e.g., 'oi-morning-scan')" }),
      persona: Type.Optional(Type.String({ description: "Persona to use (defaults to current persona)" })),
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
        const input = { ...params, persona: params.persona || persona || "trader" } as CreateJobInput;
        const job = store.create(input);
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

export function createScheduleTools(store: JobStore, persona?: string): AgentTool[] {
  return [
    createScheduleCreateTool(store, persona),
    createScheduleDeleteTool(store),
    createScheduleListTool(store),
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createTools(browser: BrowserController, skills: Skill[], jobStore?: JobStore, persona?: string): AgentTool[] {
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
    tools.push(...createScheduleTools(jobStore, persona));
  }
  return tools;
}
