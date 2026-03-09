# x-lens Daemon — Agent-Driven Autonomous Monitoring

## Goal

Add a 24/7 daemon mode to x-lens where the agent itself is the brain — it creates schedules, monitors markets, learns from results, adapts its behavior, and pushes macOS notifications when it finds something actionable.

## Core Concept

The daemon is not a dumb cron runner. The agent decides what to monitor, when, and how often. You tell it "watch the market" in natural language and it handles the rest — creating jobs, running them, learning what produces signal vs noise, and alerting you only when something matters.

## Architecture

```
x-lens daemon start
  │
  ├── DaemonProcess (app/src/daemon.ts)
  │   ├── SessionManager — one persistent Agent per persona
  │   ├── JobRunner — executes cron/interval/continuous jobs
  │   ├── JobStore — agent-managed job registry (~/.x-lens/jobs.json)
  │   ├── NotificationService — macOS native notifications
  │   └── WebhookServer — HTTP endpoint for external triggers
  │
  ├── Trader Session (persistent, resumes across restarts)
  │   ├── OI scan — cron 6:30 AM ET weekdays
  │   ├── Market regime — cron 9:00 AM ET weekdays
  │   └── Custom jobs the agent creates
  │
  └── Predictor Session (persistent, resumes across restarts)
      ├── Prediction market sweep — interval 60 min
      ├── BTC/ETH latency arb — continuous loop
      └── Custom jobs the agent creates
```

## Components

### 1. Daemon Process (`app/src/daemon.ts`)

Long-running Node process. Entry point for `x-lens daemon start`.

Responsibilities:
- Initialize persona sessions from job store
- Run the job scheduler loop
- Handle graceful shutdown (SIGTERM/SIGINT)
- Catch uncaught exceptions per-job (don't crash the whole daemon)
- Log to `~/.x-lens/daemon.log`

Process management:
- `x-lens daemon install` — generates `~/Library/LaunchAgents/com.x-lens.daemon.plist`, loads it via `launchctl`. Daemon starts on boot, restarts on crash.
- `x-lens daemon start` — run in foreground (for development/debugging)
- `x-lens daemon stop` — stop via launchctl or SIGTERM
- `x-lens daemon status` — show uptime, active jobs, last results, next runs
- `x-lens daemon uninstall` — unload and remove plist
- `x-lens daemon logs` — tail `~/.x-lens/daemon.log`

### 2. Session Manager (`app/src/session-manager.ts`)

Manages one persistent Agent instance per persona.

- Sessions stored at `~/.x-lens/sessions/<persona>.jsonl` (one per persona, not shared)
- On daemon start, loads existing sessions for all personas that have jobs
- Sessions survive daemon restarts — full message history restored
- Context compaction when sessions approach token limits (same as REPL)
- Lazy initialization — persona session created on first job that needs it

### 3. Job Store (`~/.x-lens/jobs.json`)

Agent-managed JSON file. The agent creates, modifies, and deletes jobs using tools. Not hand-edited.

```json
{
  "jobs": [
    {
      "id": "oi-morning-scan",
      "persona": "trader",
      "prompt": "Run full OI scan for SPY, QQQ, NVDA, TSLA. Alert me on confidence >65%",
      "type": "cron",
      "schedule": "30 6 * * 1-5",
      "enabled": true,
      "created_at": "2026-03-08T10:00:00Z",
      "last_run": "2026-03-08T06:30:00Z",
      "last_result_summary": "NVDA CALL 72% confidence",
      "run_count": 12,
      "notify": true
    },
    {
      "id": "crypto-prediction-sweep",
      "persona": "predictor",
      "prompt": "Scan Polymarket crypto markets. Alert on edge >10%",
      "type": "interval",
      "interval_minutes": 60,
      "enabled": true,
      "created_at": "2026-03-08T10:00:00Z",
      "last_run": "2026-03-08T15:00:00Z",
      "last_result_summary": "BTC 150K YES at $0.32, my estimate 45%, edge +13%",
      "run_count": 48,
      "notify": true
    },
    {
      "id": "btc-arb-monitor",
      "persona": "predictor",
      "prompt": "Monitor BTC 5-min markets for latency arb opportunities. Alert when spread detected.",
      "type": "continuous",
      "pause_seconds": 30,
      "enabled": true,
      "created_at": "2026-03-08T10:00:00Z",
      "last_run": "2026-03-08T16:42:00Z",
      "last_result_summary": "No arb window detected",
      "run_count": 1847,
      "notify": true
    }
  ]
}
```

Job types:
- **cron** — standard cron expression (e.g., `30 6 * * 1-5` = 6:30 AM weekdays)
- **interval** — every N minutes
- **continuous** — loop with configurable pause between iterations

### 4. Agent Tools (3 new tools in `app/src/tools.ts`)

```typescript
schedule_create {
  id: string,           // unique job ID
  persona: string,      // which persona session runs this
  prompt: string,       // what to do each run
  type: "cron" | "interval" | "continuous",
  schedule?: string,    // cron expression (for type=cron)
  interval_minutes?: number,  // (for type=interval)
  pause_seconds?: number,     // (for type=continuous)
  notify: boolean       // send macOS notification on results
}

schedule_delete {
  id: string            // job ID to remove
}

schedule_list {}        // returns all jobs with status
```

The agent calls these like any tool. Example flow:
- User: "Check prediction markets every hour"
- Agent reasons: needs predictor persona, interval type, 60 min
- Agent calls `schedule_create` with appropriate params
- Job starts running immediately

### 5. Notification Service (`app/src/notify.ts`)

macOS native notifications via `osascript`:

```typescript
function notify(title: string, body: string, sound?: string): void {
  // osascript -e 'display notification "body" with title "title" sound name "default"'
}
```

Notification content:
- **Title**: `[TRADER] NVDA: CALL 72%`
- **Body**: `Institutional call accumulation at $145. Entry above $143, target $155. R:R 2.5:1`

The agent decides when to notify based on its analysis. Not every job run triggers a notification — only when the agent finds something actionable.

### 6. Learning Loop

After each job execution, the agent:
1. Evaluates whether the result was useful signal or noise
2. Writes learnings to its persona memory (`~/.x-lens/MEMORY.md` or persona-specific)
3. Can modify its own schedules (disable low-value jobs, increase frequency for hot opportunities)
4. Memory is loaded at each job run, so learnings compound over days/weeks

Example learning progression:
- Day 1: Scans 18 tickers, most return Grade C/D data
- Day 3: Agent writes to memory "Skip XLE, XLF, GLD — consistently low OI data quality"
- Day 5: Agent modifies its scan to focus on 8 high-quality tickers
- Day 10: Agent notices NVDA OI is noisy on Mondays (options expiry effects), adjusts

### 7. Webhook Server (optional, port configurable)

Minimal HTTP server for external triggers:

```
POST http://localhost:3457/webhook
{
  "persona": "trader",
  "prompt": "BTC just dropped 5% — analyze impact on open positions",
  "notify": true
}
```

This allows external tools (price alerts, TradingView webhooks, news APIs) to trigger the agent.

## Interaction Model

```
                    ┌─────────────────────────┐
                    │     You (occasional)     │
                    └──────────┬──────────────┘
                               │
                    "watch crypto markets"
                               │
                    ┌──────────▼──────────────┐
                    │    Daemon Agent (24/7)   │
                    │                         │
                    │  ┌─ Trader Session ────┐ │
                    │  │  OI scan 6:30 AM    │ │
                    │  │  Market regime 9 AM │ │
                    │  │  Learns: skip XYZ   │ │
                    │  └─────────────────────┘ │
                    │                         │
                    │  ┌─ Predictor Session ─┐ │
                    │  │  Poly scan hourly   │ │
                    │  │  BTC arb continuous  │ │
                    │  │  Learns: focus ETH   │ │
                    │  └─────────────────────┘ │
                    └──────────┬──────────────┘
                               │
                    macOS notification:
                    "NVDA: CALL 72%, entry $145"
```

## CLI

```bash
x-lens daemon start              # start in foreground
x-lens daemon install            # install as launchd service (auto-boot, auto-restart)
x-lens daemon stop               # stop daemon
x-lens daemon status             # uptime, active jobs, last results, next runs
x-lens daemon uninstall          # remove launchd service
x-lens daemon logs               # tail ~/.x-lens/daemon.log

# Initial setup (via REPL, tells daemon what to do)
x-lens --persona trader "set up daily OI monitoring for me"
# Agent creates schedule_create calls → jobs appear in daemon
```

## File Changes

### New files
- `app/src/daemon.ts` — daemon process, job runner, CLI commands
- `app/src/session-manager.ts` — per-persona agent session management
- `app/src/notify.ts` — macOS notification service
- `app/src/webhook-server.ts` — HTTP webhook endpoint

### Modified files
- `app/src/main.ts` — add `daemon` subcommand (start/stop/install/status/uninstall/logs)
- `app/src/tools.ts` — add `schedule_create`, `schedule_delete`, `schedule_list` tools

### New runtime files
- `~/.x-lens/jobs.json` — agent-managed job store
- `~/.x-lens/daemon.log` — daemon log file
- `~/.x-lens/daemon.pid` — PID file for process management
- `~/.x-lens/sessions/<persona>.jsonl` — per-persona session history

## Dependencies

- `node-cron` — cron expression parsing and scheduling (lightweight, no external deps)
- No other new dependencies. Notifications use osascript (built into macOS). HTTP server uses Node's built-in `http` module.

## Out of Scope

- No web UI / dashboard (terminal + notifications only)
- No multi-device push (macOS notifications only)
- No auto-execution of trades (alerts only, you decide)
- No distributed/multi-machine support
