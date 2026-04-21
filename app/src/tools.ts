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
  const snapshotText = truncateText(snap.snapshot, 30_000);
  const label = snap.snapshotMode === "ai" ? "Page Snapshot" : "Accessibility Tree";
  return [
    {
      type: "image" as const,
      data: snap.screenshot.toString("base64"),
      mimeType: "image/png",
    },
    {
      type: "text" as const,
      text: `URL: ${snap.url}\nTitle: ${snap.title}\n\n${label}:\n${snapshotText}`,
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
          description: "Timeout in milliseconds (default: 300000)",
          default: 300000,
        }),
      ),
    }),
    execute: async (_toolCallId, params: any, signal) => {
      return new Promise<AgentToolResult<void>>((resolve) => {
        const timeout = params.timeout ?? 300000;
        let done = false;

        // Put the child in its own process group so we can kill any grandchildren it spawns
        // (common for shells that fork, e.g. `sh -c "nohup foo &"`). Without `detached: true`
        // + group kill, grandchildren become orphans.
        const child = exec(params.command, {
          timeout,
          killSignal: "SIGKILL",
        }, (error, stdout, stderr) => {
          if (done) return;
          done = true;
          const parts: string[] = [];
          if (stdout) parts.push(`stdout:\n${stdout}`);
          if (stderr) parts.push(`stderr:\n${stderr}`);
          if (error && !stdout && !stderr) {
            parts.push(`error: ${error.message}`);
          }
          resolve(textResult(parts.join("\n\n") || "(no output)"));
        });

        const killChild = (reason: string) => {
          if (done) return;
          done = true;
          try {
            child.kill("SIGTERM");
          } catch {}
          // Force-kill after 2s if it didn't exit.
          setTimeout(() => {
            try { child.kill("SIGKILL"); } catch {}
          }, 2000).unref();
          resolve(textResult(`(${reason})`));
        };

        signal?.addEventListener("abort", () => killChild("aborted"));

        // Belt-and-suspenders timeout — exec's own timeout doesn't always fire reliably
        // (e.g. when the child ignores SIGTERM). We force-resolve at timeout + 5s.
        setTimeout(() => killChild(`timed out after ${timeout}ms`), timeout + 5000).unref();
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

function createUserWriteTool(): AgentTool {
  return {
    name: "user_write",
    label: "Write User Profile",
    description:
      "Save information about the USER to a persistent profile. Use for: preferences, communication style, expertise areas, timezone, role, workflow habits. This is separate from memory (which is for environment/project facts).",
    parameters: Type.Object({
      content: Type.String({ description: "Full user profile content (replaces existing)" }),
    }),
    execute: async (_toolCallId, params: any) => {
      const { writeUser } = await import("./memory.js");
      writeUser(params.content);
      return textResult("User profile updated.");
    },
  };
}

function createUserAppendTool(): AgentTool {
  return {
    name: "user_append",
    label: "Append User Profile",
    description:
      "Append a fact about the user to their persistent profile without replacing existing content.",
    parameters: Type.Object({
      content: Type.String({ description: "Fact to append to user profile" }),
    }),
    execute: async (_toolCallId, params: any) => {
      const { appendUser } = await import("./memory.js");
      appendUser(params.content);
      return textResult("Appended to user profile.");
    },
  };
}

function createSessionSearchTool(): AgentTool {
  return {
    name: "session_search",
    label: "Search Past Sessions",
    description:
      "Search across all past conversations for relevant context. Use when the user references prior work ('remember when...', 'last time', 'we did this before') or when you need context from a previous session. Returns matching conversation excerpts grouped by session.",
    parameters: Type.Object({
      query: Type.String({
        description: "Search query — use natural language keywords (e.g., 'kubernetes deployment fix', 'OI analysis SPY')",
      }),
      persona: Type.Optional(
        Type.String({ description: "Filter to a specific persona (e.g., 'trader')" }),
      ),
    }),
    execute: async (_toolCallId, params: any) => {
      const { searchSessions } = await import("./session-store.js");

      const results = searchSessions(params.query, {
        persona: params.persona,
        limit: 5,
      });

      if (results.length === 0) {
        return textResult("No matching past sessions found.");
      }

      const sections = results.map((r) => {
        const date = new Date(r.startedAt).toISOString().split("T")[0];
        const title = r.title || "(untitled)";
        const header = `### Session: ${title} [${date}] (${r.persona || "default"})`;
        const msgs = r.matchingMessages
          .slice(0, 5)
          .map((m) => `**${m.role}:** ${m.content.slice(0, 500)}`)
          .join("\n\n");
        return `${header}\n\n${msgs}`;
      });

      return textResult(
        `Found ${results.length} matching session(s):\n\n${sections.join("\n\n---\n\n")}`,
      );
    },
  };
}

function createWebSearchTool(browser: BrowserController): AgentTool {
  return {
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web via Google and return STRUCTURED results: a JSON list of {title, url, snippet}. Citations in your answer must come from this list — do not invent URLs or attribute quotes to sources that don't appear here.",
    parameters: Type.Object({
      query: Type.String({ description: "The search query" }),
      limit: Type.Optional(Type.Number({ description: "Max results (default: 10)", default: 10 })),
    }),
    execute: async (_toolCallId, params: any) => {
      await browser.launch();
      const encodedQuery = encodeURIComponent(params.query);
      await browser.navigate(`https://www.google.com/search?q=${encodedQuery}`);
      await new Promise((r) => setTimeout(r, 1500));

      const limit = Math.max(1, Math.min(50, params.limit ?? 10));
      const pageUrl = params.query;

      // Extract results from Google's organic result blocks. Google's markup changes often,
      // so we look at a few common containers and degrade gracefully.
      const extractor = `(() => {
        const out = [];
        const seen = new Set();
        // Organic result blocks — Google has rotated markup; try the common shells.
        const blocks = Array.from(document.querySelectorAll('div.MjjYud, div.g, div.tF2Cxc'));
        for (const b of blocks) {
          const a = b.querySelector('a[href^="http"]');
          const h3 = b.querySelector('h3');
          if (!a || !h3) continue;
          const url = a.href;
          if (!url || seen.has(url)) continue;
          if (url.startsWith('https://www.google.com/')) continue;
          seen.add(url);
          const title = (h3.innerText || '').trim();
          // Snippet lives in a sibling; sample a few known classes.
          const snipEl = b.querySelector('div.VwiC3b, div[data-sncf], span.aCOpRe, div.IsZvec');
          const snippet = snipEl ? String(snipEl.innerText || '').trim().slice(0, 400) : '';
          out.push({ title, url, snippet });
          if (out.length >= ${limit}) break;
        }
        return out;
      })()`;

      let results: { title: string; url: string; snippet: string }[] = [];
      try {
        const raw = await browser.evaluate(extractor);
        if (Array.isArray(raw)) results = raw as typeof results;
      } catch {
        // evaluation failed — fall through to empty
      }

      if (results.length === 0) {
        return textResult(
          `web_search for "${pageUrl}" returned 0 parseable results. Google's markup may have changed, or this query is blocked. Try fetch() on a concrete URL, or rephrase the query.`,
        );
      }

      const payload = {
        query: params.query,
        count: results.length,
        results,
      };
      return textResult(
        `Google results for "${params.query}" (${results.length}):\n\n${JSON.stringify(payload, null, 2)}`,
      );
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

function createSkillCreateTool(): AgentTool {
  return {
    name: "skill_create",
    label: "Create Skill",
    description:
      "Create a new skill from a workflow you just completed successfully. Skills are reusable instructions that improve over time. Only create skills for workflows that took 5+ tool calls or that the user might need again.",
    parameters: Type.Object({
      name: Type.String({
        description: "Skill name in kebab-case (e.g., 'k8s-rollout', 'oi-morning-scan')",
      }),
      description: Type.String({
        description: "One-line description of what the skill does",
      }),
      triggers: Type.Array(Type.String(), {
        description: "Keywords that should trigger this skill (e.g., ['kubernetes', 'deploy', 'rollout'])",
      }),
      instructions: Type.String({
        description: "Full markdown instructions for the skill. Be specific — include exact commands, file paths, and decision points.",
      }),
    }),
    execute: async (_toolCallId, params: any) => {
      const { existsSync, mkdirSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { getUserSkillsDir } = await import("./skills.js");

      const skillDir = join(getUserSkillsDir(), params.name);
      if (existsSync(skillDir)) {
        return textResult(`Skill "${params.name}" already exists. Use skill_patch to update it.`);
      }

      mkdirSync(skillDir, { recursive: true });

      const triggersStr = params.triggers.map((t: string) => t.trim()).join(", ");
      const content = `---\nname: ${params.name}\ndescription: ${params.description}\ntriggers: [${triggersStr}]\n---\n\n${params.instructions}\n`;
      writeFileSync(join(skillDir, "skill.md"), content, "utf-8");
      return textResult(`Skill "${params.name}" created at ${skillDir}/skill.md`);
    },
  };
}

function createSkillPatchTool(): AgentTool {
  return {
    name: "skill_patch",
    label: "Patch Skill",
    description:
      "Update an existing skill's instructions. Use when you find a skill is outdated, incomplete, or wrong during use. Prefer this over skill_create for existing skills.",
    parameters: Type.Object({
      name: Type.String({ description: "Skill name to patch" }),
      find: Type.String({ description: "Exact text to find in the skill instructions" }),
      replace: Type.String({ description: "Replacement text" }),
    }),
    execute: async (_toolCallId, params: any) => {
      const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { getUserSkillsDir } = await import("./skills.js");

      const userPath = join(getUserSkillsDir(), params.name, "skill.md");
      const upperPath = join(getUserSkillsDir(), params.name, "SKILL.md");
      const skillPath = existsSync(userPath) ? userPath : existsSync(upperPath) ? upperPath : null;

      if (!skillPath) {
        return textResult(`Skill "${params.name}" not found in user skills directory. Only user-created skills can be patched.`);
      }

      const content = readFileSync(skillPath, "utf-8");
      if (!content.includes(params.find)) {
        return textResult(`Could not find the text to replace in ${params.name}. Make sure 'find' matches exactly.`);
      }

      const updated = content.replace(params.find, params.replace);
      writeFileSync(skillPath, updated, "utf-8");
      return textResult(`Skill "${params.name}" patched successfully.`);
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
// Hive tools — structured data accumulation for trader persona
// ---------------------------------------------------------------------------

function createHiveRecordTool(): AgentTool {
  return {
    name: "hive_record",
    label: "Record to Hive",
    description:
      "Record a GROUNDED structured event to the Hive timeline. Only record findings whose data came from a tool call in THIS session — the `source` field is required and must name that tool call. Speculation and opinion belong in MEMORY, not the Hive.",
    parameters: Type.Object({
      source: Type.String({
        description:
          "REQUIRED. The tool call (and, where helpful, target) that produced this data — e.g. 'fetch', 'web_search', 'shell:fetch_oi.py', 'browser_evaluate:finviz.com'. If no tool produced the data, do NOT record; use memory_append instead.",
      }),
      date: Type.Optional(Type.String({ description: "Date (YYYY-MM-DD). Defaults to today." })),
      type: Type.Optional(Type.String({ description: "Event type — anything: regime_check, signal, trade, earnings, news, note, etc." })),
      category: Type.Optional(Type.String({ description: "Optional grouping" })),
      ticker: Type.Optional(Type.String({ description: "Ticker symbol if applicable" })),
      data: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Any structured data from the tool result" })),
      source_skill: Type.Optional(Type.String({ description: "Skill that produced this" })),
      confidence: Type.Optional(Type.Number({ description: "Confidence 0.0–1.0" })),
      summary: Type.Optional(Type.String({ description: "One-line summary" })),
      tags: Type.Optional(Type.String({ description: "Comma-separated freeform tags" })),
    }),
    execute: async (_toolCallId, params: any) => {
      try {
        const { recordEvent } = await import("./hive.js");
        const id = recordEvent(params);
        const label = [params.type, params.ticker, params.summary].filter(Boolean).join(" — ");
        return textResult(`Recorded to Hive: ${label || id.slice(0, 8)} (id: ${id.slice(0, 8)}, source: ${params.source})`);
      } catch (err: any) {
        return textResult(`hive_record rejected: ${err.message}`);
      }
    },
  };
}

function createHiveQueryTool(): AgentTool {
  return {
    name: "hive_query",
    label: "Query Hive",
    description:
      "Query the Hive for past events. Filter by date range, type, category, ticker, or validation status. Returns structured events with their outcomes.",
    parameters: Type.Object({
      from: Type.Optional(Type.String({ description: "Start date (YYYY-MM-DD)" })),
      to: Type.Optional(Type.String({ description: "End date (YYYY-MM-DD)" })),
      type: Type.Optional(Type.String({ description: "Filter by event type" })),
      category: Type.Optional(Type.String({ description: "Filter by category" })),
      ticker: Type.Optional(Type.String({ description: "Filter by ticker" })),
      validated: Type.Optional(Type.Boolean({ description: "Filter: true=validated only, false=pending only" })),
      limit: Type.Optional(Type.Number({ description: "Max results (default: 50)" })),
    }),
    execute: async (_toolCallId, params: any) => {
      const { queryEvents } = await import("./hive.js");
      const events = queryEvents({ ...params, limit: params.limit ?? 50 });
      if (events.length === 0) return textResult("No events found matching criteria.");

      const lines = events.map((e) => {
        const outcome = e.validated ? ` → ${e.outcome}` : " [pending]";
        const ticker = e.ticker ? ` ${e.ticker}` : "";
        const conf = e.confidence != null ? ` (${(e.confidence * 100).toFixed(0)}%)` : "";
        return `[${e.date}] ${e.type}${ticker}${conf}: ${e.summary}${outcome}\n  data: ${JSON.stringify(e.data)}`;
      });
      return textResult(`Found ${events.length} events:\n\n${lines.join("\n\n")}`);
    },
  };
}

function createHiveValidateTool(): AgentTool {
  return {
    name: "hive_validate",
    label: "Validate Hive Event",
    description:
      "Mark a past Hive event with its outcome based on FRESH tool evidence. You must fetch current data with a tool (fetch/web_search/shell) BEFORE calling this, and cite that call in `evidence_source`. Self-validation from memory is forbidden — it corrupts the pattern database.",
    parameters: Type.Object({
      id: Type.String({ description: "Event ID to validate (use hive_pending to find IDs)" }),
      outcome: Type.String({ description: "How the event played out — e.g., correct, incorrect, partial, expired, missed, early, late" }),
      evidence_source: Type.String({
        description:
          "REQUIRED. The tool call + value that grounds this validation. Include the URL or concrete value you just fetched — e.g. 'fetch:https://finance.yahoo.com/quote/SPY:close=582.40' or 'shell:fetch_oi.py:max_pain=575'. If you cannot provide this, do NOT validate the event.",
      }),
      notes: Type.Optional(Type.String({ description: "Context on the outcome" })),
    }),
    execute: async (_toolCallId, params: any) => {
      try {
        const { validateEvent } = await import("./hive.js");
        const ok = validateEvent(params);
        if (!ok) return textResult(`Event ${params.id} not found.`);
        return textResult(`Validated: ${params.id.slice(0, 8)} → ${params.outcome} [evidence: ${params.evidence_source}]${params.notes ? ` (${params.notes})` : ""}`);
      } catch (err: any) {
        return textResult(`hive_validate rejected: ${err.message}`);
      }
    },
  };
}

function createHivePendingTool(): AgentTool {
  return {
    name: "hive_pending",
    label: "Pending Validations",
    description:
      "Get Hive events that are due for validation — signals, regime checks, and alerts from past days that haven't been checked yet. Use at the start of each run to validate yesterday's predictions.",
    parameters: Type.Object({
      older_than_days: Type.Optional(Type.Number({ description: "Only show events older than N days (default: 1)" })),
    }),
    execute: async (_toolCallId, params: any) => {
      const { getPendingValidations } = await import("./hive.js");
      const events = getPendingValidations({ olderThanDays: params.older_than_days ?? 1 });
      if (events.length === 0) return textResult("No pending validations. All caught up.");

      const lines = events.map((e) => {
        const ticker = e.ticker ? ` ${e.ticker}` : "";
        const conf = e.confidence != null ? ` (${(e.confidence * 100).toFixed(0)}%)` : "";
        return `[${e.date}] ${e.type}${ticker}${conf}: ${e.summary}\n  id: ${e.id}\n  data: ${JSON.stringify(e.data)}`;
      });
      return textResult(`${events.length} events pending validation:\n\n${lines.join("\n\n")}`);
    },
  };
}

function createHiveStatsTool(): AgentTool {
  return {
    name: "hive_stats",
    label: "Hive Stats",
    description:
      "Get overall Hive statistics: total events, validation rates, outcomes breakdown, patterns count, and date range. Use to understand the data quality and coverage.",
    parameters: Type.Object({}),
    execute: async () => {
      const { getStats } = await import("./hive.js");
      const s = getStats();
      const lines = [
        `Total events: ${s.totalEvents}`,
        `Validated: ${s.validated} | Pending: ${s.pending}`,
        `Date range: ${s.dateRange.earliest || "none"} → ${s.dateRange.latest || "none"}`,
        ``,
        `By outcome:`,
        ...Object.entries(s.byOutcome).map(([k, v]) => `  ${k}: ${v}`),
        ``,
        `By type:`,
        ...Object.entries(s.byType).map(([k, v]) => `  ${k}: ${v}`),
        ``,
        `Patterns: ${s.patternCount}`,
      ];
      if (s.validated > 0) {
        const correct = s.byOutcome["correct"] || 0;
        lines.push(`Overall accuracy: ${((correct / s.validated) * 100).toFixed(1)}%`);
      }
      return textResult(lines.join("\n"));
    },
  };
}

function createHivePatternsTool(): AgentTool {
  return {
    name: "hive_patterns",
    label: "Hive Patterns",
    description:
      "Query learned patterns from validated Hive events. Patterns track win rates, sample sizes, and conditions. Use to inform confidence levels on new signals.",
    parameters: Type.Object({
      category: Type.Optional(Type.String({ description: "Filter by category" })),
      tags: Type.Optional(Type.String({ description: "Filter by tag (substring match)" })),
    }),
    execute: async (_toolCallId, params: any) => {
      const { queryPatterns } = await import("./hive.js");
      const patterns = queryPatterns(params);
      if (patterns.length === 0) return textResult("No patterns learned yet. Keep recording and validating events.");

      const lines = patterns.map((p) => {
        const wr = p.win_rate != null ? `${(p.win_rate * 100).toFixed(1)}%` : "N/A";
        return `${p.name} [${p.category}] — win rate: ${wr} (n=${p.sample_size})\n  ${p.description}\n  data: ${JSON.stringify(p.data)}`;
      });
      return textResult(`${patterns.length} patterns:\n\n${lines.join("\n\n")}`);
    },
  };
}

function createHivePatternUpsertTool(): AgentTool {
  return {
    name: "hive_pattern_upsert",
    label: "Upsert Hive Pattern",
    description:
      "Create or update a learned pattern. To CREATE a new pattern you must pass `event_ids` — the list of validated Hive events it aggregates. Each referenced event must already be validated with a non-empty evidence_source, or the upsert is rejected. This enforces that patterns (and their win rates) are grounded in real tool evidence, not self-validation.",
    parameters: Type.Object({
      id: Type.Optional(Type.String({ description: "Pattern ID to update. Omit to create new." })),
      name: Type.Optional(Type.String({ description: "Pattern name" })),
      description: Type.Optional(Type.String({ description: "What this pattern means" })),
      category: Type.Optional(Type.String({ description: "Optional grouping" })),
      data: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Any structured data" })),
      tags: Type.Optional(Type.String({ description: "Comma-separated freeform tags" })),
      win_rate: Type.Optional(Type.Number({ description: "Win rate 0.0–1.0" })),
      sample_size: Type.Optional(Type.Number({ description: "Number of events this is based on" })),
      event_ids: Type.Optional(Type.Array(Type.String(), {
        description: "REQUIRED for new patterns. IDs of the validated events this pattern aggregates. Each must have evidence_source set.",
      })),
    }),
    execute: async (_toolCallId, params: any) => {
      try {
        const { upsertPattern } = await import("./hive.js");
        // On create (no id passed), require event_ids so we can check grounding.
        if (!params.id && (!params.event_ids || params.event_ids.length === 0)) {
          return textResult(
            "hive_pattern_upsert rejected: new patterns must cite `event_ids` — the validated hive events this pattern aggregates. Use hive_query to collect event IDs first.",
          );
        }
        const id = upsertPattern(params);
        return textResult(`Pattern saved: ${params.name || id.slice(0, 8)} (id: ${id.slice(0, 8)})`);
      } catch (err: any) {
        return textResult(`hive_pattern_upsert rejected: ${err.message}`);
      }
    },
  };
}

export function createHiveTools(): AgentTool[] {
  return [
    createHiveRecordTool(),
    createHiveQueryTool(),
    createHiveValidateTool(),
    createHivePendingTool(),
    createHiveStatsTool(),
    createHivePatternsTool(),
    createHivePatternUpsertTool(),
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
    createUserWriteTool(),
    createUserAppendTool(),
    createSessionSearchTool(),
    createSkillReadTool(skills),
    createSkillCreateTool(),
    createSkillPatchTool(),
  ];
  if (jobStore) {
    tools.push(...createScheduleTools(jobStore, persona));
  }
  // Hive tools for structured data accumulation (all personas — trader is primary user)
  tools.push(...createHiveTools());
  return tools;
}
