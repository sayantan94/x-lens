import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import { getModel, type Message, type Model, type Api } from "@mariozechner/pi-ai";
import cron from "node-cron";
import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { BrowserController } from "./browser.js";
import { createTools } from "./tools.js";
import { loadSkills, formatSkillsForPrompt } from "./skills.js";
import { readMemory } from "./memory.js";
import { JobStore, type Job, type CreateJobInput } from "./job-store.js";
import {
  loadPersonaSession,
  appendPersonaSessionMessage,
  savePersonaSession,
} from "./session-manager.js";
import { notify } from "./notify.js";
import { shouldCompact, isContextOverflow, compact } from "./compaction.js";

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
// System prompt
// ---------------------------------------------------------------------------

function buildDaemonSystemPrompt(
  skills: ReturnType<typeof loadSkills>,
  memory: string,
  persona: string,
): string {
  const skillsSection = formatSkillsForPrompt(skills);

  return `You are x-lens, a senior autonomous trading analyst running 24/7 as the "${persona}" persona.

You are NOT a passive task executor. You are a proactive market intelligence system. You have a full suite of trading skills — USE THEM ALL. Your job is to continuously monitor markets, detect opportunities and risks, and alert the user ONLY when something is actionable.

## Your Mission
- Detect market regime changes (GREEN → YELLOW → RED) and alert immediately
- Monitor sector rotation — which sectors are gaining/losing momentum
- Spot breakout setups (VCP, CANSLIM) across the market
- Track institutional positioning via open interest analysis
- Analyze earnings surprises and post-earnings drift opportunities
- Watch market breadth for divergences (price up but breadth deteriorating = danger)
- Monitor macro regime (Fed, yields, dollar, VIX) for shifts
- Identify high-conviction trade setups with entry/stop/target

## How to Think
For each scheduled run:
1. What is the CURRENT market regime? (Use market-regime-classifier, market-environment-analysis)
2. Is anything CHANGING? (Compare to your memory of previous runs)
3. Are there ACTIONABLE setups? (Use screeners, OI analysis, earnings calendar)
4. Should the user be ALERTED? (Only for high-conviction, time-sensitive findings)
5. What should you REMEMBER? (Save learnings, update your model of the market)

## Alert Criteria — Only notify when:
- Market regime changes (e.g., GREEN → YELLOW)
- High-confidence trade setup found (>65% conviction with clear entry/stop/target)
- Significant OI positioning shift detected (institutional accumulation/distribution)
- Market drop >1% intraday or sharp sector rotation
- Earnings surprise with PEAD opportunity
- Something you've been tracking hits a trigger level

## DO NOT alert for:
- Routine scans with no signal
- Low-confidence findings (<55%)
- Information the user already knows (check memory)
- Minor price fluctuations

## Skill Usage Protocol
1. BEFORE doing anything, scan the Available Skills list below
2. If ANY skill matches, call skill_read to load its full instructions FIRST
3. Follow the skill's instructions exactly — they contain proven workflows
4. Chain multiple skills together when the situation calls for it
5. Use general capabilities (browser, fetch, shell) to fill gaps between skills

## Schedule Management
You can create, modify, and delete your own monitoring schedules:
- schedule_create: Add new monitoring jobs
- schedule_delete: Remove jobs that aren't producing value
- schedule_list: Review your current schedule

Adapt your schedule based on market conditions:
- Volatile days → increase scan frequency
- Quiet days → reduce frequency, save resources
- Earnings season → add earnings-specific scans
- If a scan consistently returns no signal → disable it, note in memory

## Notification Format
When you find something actionable, include this marker:
[ALERT] <short title> | <1-2 sentence summary with key numbers>

Examples:
[ALERT] Market Regime: GREEN → YELLOW | VIX spiked 15%, breadth deteriorating. SPY below 20DMA. Reduce position sizes.
[ALERT] NVDA CALL Setup 72% | Institutional call accumulation at $145 strike, 60DTE. Entry above $143, stop $138, target $155.
[ALERT] Sector Rotation: Tech → Healthcare | XLK down 2.3%, XLV up 1.8%. Relative strength shift confirmed across 3 timeframes.

## Your Memory
${memory}

You MUST save important findings to memory using memory_append. This is how you learn across runs.
Save: regime changes, trade outcomes, which scans produce signal, market patterns you've noticed.

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
  const toolStartTimes = new Map<string, { startTime: number; name: string }>();

  const unsubscribe = pa.agent.subscribe((event: AgentEvent) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      responseText += event.assistantMessageEvent.delta;
    }

    // Tool execution start — log tool name + args
    if (event.type === "tool_execution_start") {
      const args = (event.args ?? {}) as Record<string, unknown>;
      toolStartTimes.set(event.toolCallId, { startTime: Date.now(), name: event.toolName });
      const argSummary = Object.entries(args)
        .map(([k, v]) => {
          const val = typeof v === "string" && v.length > 100 ? v.slice(0, 100) + "..." : String(v);
          return `${k}=${val}`;
        })
        .join(", ");
      log(`[${job.persona}] ▶ ${event.toolName}(${argSummary})`);
    }

    // Tool execution end — log result preview + duration
    if (event.type === "tool_execution_end") {
      const started = toolStartTimes.get(event.toolCallId);
      const durationMs = started ? Date.now() - started.startTime : 0;
      const durationStr = durationMs > 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`;
      toolStartTimes.delete(event.toolCallId);

      const isErr = !!(event as any).isError;
      const result = event.result as any;
      let preview = "";
      if (result?.content) {
        const textPart = Array.isArray(result.content)
          ? result.content.find((c: any) => c.type === "text")?.text
          : typeof result.content === "string" ? result.content : "";
        if (textPart) {
          preview = ` → ${textPart.slice(0, 150).replace(/\n/g, " ")}`;
          if (textPart.length > 150) preview += "...";
        }
      }
      const icon = isErr ? "✗" : "✓";
      log(`[${job.persona}] ${icon} ${event.toolName} (${durationStr})${preview}`);
    }

    if (event.type === "message_end") {
      appendPersonaSessionMessage(job.persona, event.message as Message);
      const msg = event.message as any;
      if (msg.role === "assistant" && msg.usage) {
        pa.lastInputTokens = msg.usage.input + (msg.usage.cacheRead || 0);
        log(`[${job.persona}] tokens: ${msg.usage.input} input, ${msg.usage.output} output`);
      }
    }

    if (event.type === "agent_end") {
      // Log the final response
      if (responseText) {
        log(`[${job.persona}] Response:\n${responseText}`);
      }

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

    // Check for [ALERT] markers — send notification
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
  persona?: string;
} = {}): Promise<void> {
  const provider = options.provider || process.env.X_LENS_PROVIDER || "bedrock";
  const modelId = options.model || process.env.X_LENS_MODEL;
  const persona = options.persona || "trader";
  const projectRoot = new URL("../..", import.meta.url).pathname;
  const jobStore = new JobStore();

  ensureDir(X_LENS_DIR);

  // Write PID file
  writeFileSync(PID_FILE, String(process.pid), "utf-8");

  log("=== x-lens daemon starting ===");
  log(`Provider: ${provider}, Persona: ${persona}, PID: ${process.pid}`);

  // Seed default jobs if none exist for this persona
  const existingForPersona = jobStore.list().filter((j) => j.persona === persona);
  if (existingForPersona.length === 0 && persona === "trader") {
    log(`No jobs found for persona "${persona}" — seeding default monitoring schedule`);

    const defaultJobs: CreateJobInput[] = [
      {
        id: "pre-market-briefing",
        persona: "trader",
        prompt: "Run the pre-market briefing. Check market regime (use market-regime-classifier), VIX level, overnight futures, key economic calendar events today. Classify regime as GREEN/YELLOW/RED. If regime changed from last run (check memory), alert me. Save the regime to memory.",
        type: "cron",
        schedule: "0 13 * * 1-5", // 8 AM ET = 1 PM UTC
        notify: true,
      },
      {
        id: "oi-morning-scan",
        persona: "trader",
        prompt: "Run full OI analysis (use oi-analysis skill) for SPY, QQQ, NVDA, TSLA, AAPL, MSFT, META, AMZN, GOOGL. Analyze each at 30/60/90 DTE. Alert me on any ticker with confidence >65%. Include trade setup with entry/stop/target. Compare to yesterday's positioning (check memory).",
        type: "cron",
        schedule: "30 13 * * 1-5", // 8:30 AM ET
        notify: true,
      },
      {
        id: "market-regime-check",
        persona: "trader",
        prompt: "Quick market regime check. Use market-regime-classifier and market-breadth-analyzer. Check SPY price vs 20DMA/50DMA, VIX level and trend, advance/decline ratio, new highs vs new lows. Compare to last check (memory). If regime changed or breadth is diverging from price, alert immediately.",
        type: "interval",
        interval_minutes: 60,
        notify: true,
      },
      {
        id: "sector-rotation-scan",
        persona: "trader",
        prompt: "Analyze sector rotation using sector-analyst skill. Compare relative strength of XLK, XLF, XLV, XLE, XLI, XLP, XLU, XLRE, XLC, XLB, XLY. Identify which sectors are leading/lagging. Check for rotation signals (money moving from one sector to another). Alert if significant rotation detected. Save sector rankings to memory.",
        type: "cron",
        schedule: "0 15 * * 1-5", // 10 AM ET
        notify: true,
      },
      {
        id: "breakout-screener",
        persona: "trader",
        prompt: "Run VCP screener (vcp-screener skill) and CANSLIM screener (canslim-screener skill) across the S&P 500. Look for stocks setting up or breaking out today. For any matches, check the OI positioning (oi-analysis skill) to see if institutions are confirming the move. Alert on high-conviction setups with institutional backing.",
        type: "cron",
        schedule: "0 16 * * 1-5", // 11 AM ET
        notify: true,
      },
      {
        id: "earnings-watch",
        persona: "trader",
        prompt: "Check earnings calendar for this week (earnings-calendar skill). For companies reporting today/tomorrow, analyze expected move vs implied volatility. Look for PEAD opportunities from recent reports (pead-screener skill). If any high-conviction earnings plays found, alert with trade setup.",
        type: "cron",
        schedule: "0 14 * * 1-5", // 9 AM ET
        notify: true,
      },
      {
        id: "market-close-summary",
        persona: "trader",
        prompt: "End-of-day market summary. How did the market close? What was today's regime? Any notable moves? Update your memory with: regime status, key levels for SPY/QQQ, any trades that triggered, sector rankings, and notes for tomorrow. This is your daily learning — be thorough in what you save to memory.",
        type: "cron",
        schedule: "15 21 * * 1-5", // 4:15 PM ET
        notify: true,
      },
    ];

    for (const job of defaultJobs) {
      try {
        jobStore.create(job);
        log(`  Created default job: ${job.id}`);
      } catch (err) {
        logError(`  Failed to create default job ${job.id}: ${err}`);
      }
    }
  }

  const jobs = jobStore.list();
  log(`Loaded ${jobs.length} jobs from store`);

  // Track active cron tasks and intervals for cleanup
  const cronTasks: cron.ScheduledTask[] = [];
  const intervals: NodeJS.Timeout[] = [];
  const continuousAborts = new Map<string, AbortController>();

  function scheduleJobs(): void {
    // Clear existing schedules
    for (const task of cronTasks) task.stop();
    cronTasks.length = 0;
    for (const iv of intervals) clearInterval(iv);
    intervals.length = 0;
    for (const [, ctrl] of continuousAborts) ctrl.abort();
    continuousAborts.clear();

    const currentJobs = jobStore.list().filter((j) => j.enabled && j.persona === persona);

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
        const ctrl = new AbortController();
        continuousAborts.set(job.id, ctrl);

        (async () => {
          while (!ctrl.signal.aborted) {
            const currentJob = jobStore.get(job.id);
            if (!currentJob || !currentJob.enabled) break;
            await executeJob(currentJob, jobStore, projectRoot, provider, modelId);
            await new Promise((r) => {
              const timeout = setTimeout(r, pauseMs);
              ctrl.signal.addEventListener("abort", () => { clearTimeout(timeout); r(undefined); }, { once: true });
            });
          }
          log(`Continuous job "${job.id}" stopped`);
        })();
        log(`Started continuous job "${job.id}": ${job.pause_seconds ?? 30}s pause`);
      }
    }
  }

  // Initial schedule
  scheduleJobs();

  // Re-read jobs periodically to pick up agent-created schedules
  const jobCheckInterval = setInterval(() => {
    const newJobs = jobStore.list().filter((j) => j.enabled && j.persona === persona);
    const currentScheduled = cronTasks.length + intervals.length + continuousAborts.size;
    if (newJobs.length !== currentScheduled) {
      log("Job store changed — rescheduling...");
      scheduleJobs();
    }
  }, 60_000);

  // Graceful shutdown
  const shutdown = async () => {
    log("=== x-lens daemon shutting down ===");
    clearInterval(jobCheckInterval);
    for (const task of cronTasks) task.stop();
    for (const iv of intervals) clearInterval(iv);
    for (const [, ctrl] of continuousAborts) ctrl.abort();

    for (const [persona, pa] of personaAgents) {
      try {
        await pa.browser.close();
        log(`[${persona}] Browser closed`);
      } catch { /* ignore */ }
    }

    try { unlinkSync(PID_FILE); } catch { /* ignore */ }
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  process.on("uncaughtException", (err) => {
    logError(`Uncaught exception: ${err.message}`);
  });
  process.on("unhandledRejection", (reason) => {
    logError(`Unhandled rejection: ${reason}`);
  });

  log("Daemon running. Press Ctrl+C to stop.");
  notify("x-lens Daemon", "Daemon started and monitoring.");

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
    try {
      process.kill(pid, 0);
      return pid;
    } catch {
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
