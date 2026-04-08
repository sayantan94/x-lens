<p align="center">
  <img src="logo.svg" alt="x-lens logo" width="180" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?logo=node.js" alt="Node >= 20" />
  <img src="https://img.shields.io/badge/typescript-5.9-blue?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/python-3.11+-yellow?logo=python" alt="Python 3.11+" />
  <img src="https://img.shields.io/badge/LLM-Claude%20%7C%20Bedrock%20%7C%20OpenRouter%20%7C%20Groq-purple" alt="LLM Providers" />
  <img src="https://img.shields.io/badge/tools-28-orange" alt="28 Tools" />
  <img src="https://img.shields.io/badge/skills-45+-red" alt="45+ Skills" />
  <img src="https://img.shields.io/badge/license-private-lightgrey" alt="License" />
</p>

# x-lens

A persona-based autonomous AI agent with browser capabilities and a built-in learning loop. Adding a new domain is `mkdir` and a markdown file.

### What it does

- **Browses the web autonomously** — navigate, click, type, screenshot, evaluate JavaScript
- **Follows skills written in markdown** — the LLM reads instructions and executes them using tools
- **Isolates domains via personas** — each persona gets its own browser profile, session history, system prompt, skills, and scheduled jobs
- **Runs as a daemon** — 24/7 background agent with multi-threaded job execution and macOS notifications
- **Accumulates structured data** — the Hive records market observations, validates past predictions, and builds patterns over time
- **Control plane dashboard** — `x-lens dashboard` at `localhost:3456` showing timeline, runs, simulations, and learned patterns
- **Pipe mode** — `x-lens -p` for composable CLI usage with `claude -p` and shell scripts

### What it supports

| | |
|---|---|
| **LLM Providers** | Anthropic (direct API), AWS Bedrock (20+ model providers), OpenRouter, Groq |
| **Personas** | `trader` (~40 skills), `job-finder` (4 skills), `predictor` (1 skill), or create your own |
| **Tools** | Browser (6), Shell, HTTP, Memory (3), User Profile (2), Session Search (1), Skills (3), Scheduling (3), Hive (7) — 28 total |
| **Modes** | Command, REPL (interactive), Pipe (`-p`), Daemon (24/7 multi-threaded), Dashboard, Telegram |
| **Data** | Hive DB (structured events, patterns, runs, simulations), Session DB (FTS5), MEMORY.md |
| **Skills format** | Markdown with YAML frontmatter, optional `references/` directory for progressive disclosure |
| **Browser** | Persistent Chromium via Playwright, per-persona profiles, headless or visible |
| **Platform** | macOS (native notifications via osascript), Linux (daemon mode) |

## Personas & Skills

x-lens uses a persona-based skill system. Each persona is a directory under `skills/` containing domain-specific skills. Global skills are shared across all personas.

```
skills/
├── global/              # Always loaded (3 skills)
│   ├── check-email/
│   ├── search-web/
│   └── screenshot-page/
├── trader/              # --persona trader (~40 skills)
│   ├── oi-analysis/     
│   ├── canslim-screener/
│   ├── vcp-screener/
│   ├── technical-analyst/
│   └── ...
├── predictor/           # --persona predictor (1 skill)
│   └── prediction-markets/
└── job-finder/          # --persona job-finder (4 skills)
    ├── linkedin-search/
    ├── post-extraction/
    ├── post-ranking/
    └── linkedin-login/
```

- **Global skills** (`skills/global/`) — loaded for every persona
- **Persona skills** (`skills/<persona>/`) — loaded only when that persona is active
- Persona skills override global skills on name collision
- Skills are picked up automatically — no restart needed

### Skill Detection

When you run `x-lens --persona trader`, the agent:
1. Loads all global skills from `skills/global/`
2. Loads persona-specific skills from `skills/trader/`
3. Reads each skill's frontmatter (name, description, triggers)
4. Matches your input to the best skill based on triggers and description
5. On match, loads the full `SKILL.md` body with instructions, references, and scripts

### Personas

| Persona | Flag | Skills | Focus |
|---------|------|--------|-------|
| **trader** | `--persona trader` | ~40 | Market analysis, screening, earnings, strategy, portfolio, options, OI analysis |
| **predictor** | `--persona predictor` | 1 | Prediction market trading on Polymarket & Kalshi |
| **job-finder** | `--persona job-finder` | 4 | LinkedIn hiring post search, extraction, and ranking |

### Global Skills

| Skill | Description |
|-------|-------------|
| **check-email** | Check Gmail for unread/urgent messages |
| **search-web** | Search Google and summarize results |
| **screenshot-page** | Screenshot a webpage and save it |

### Adding Skills

**Global skill** — add to `skills/global/`:

```markdown
# skills/global/my-skill/SKILL.md
---
name: my-skill
description: What this skill does
triggers: [keyword1, keyword2]
---

## Instructions
1. Step one
2. Step two
```

**Persona skill** — add to `skills/<persona>/`:

```
skills/trader/my-strategy/
├── SKILL.md          # Instructions (SKILL.md or skill.md both work)
├── references/       # Supporting docs
├── scripts/          # Scripts the agent can run
└── tests/            # Skill tests
```

**Creating a new persona:**

```bash
mkdir -p skills/researcher
# Add skill folders with SKILL.md files, then:
x-lens --persona researcher
```

## Prerequisites

- **Node.js** >= 20
- **npm**
- **Chromium** for Playwright (installed in setup below)
- **API credentials** for either Anthropic or AWS Bedrock

## Setup

```bash
# 1. Clone and install
git clone <repo-url> x-lens
cd x-lens
npm install

# 2. Install Chromium for browser automation
npx playwright install chromium

# 3. Build all packages
npm run build

# 4. Link the CLI globally
cd app && npm link && cd ..

# 5. Configure credentials
cp .env.example .env
# Edit .env with your credentials (see below)
```

## Environment Variables

Create a `.env` file in the project root. Copy from `.env.example`:

```bash
cp .env.example .env
```

### Anthropic API (direct)

```env
ANTHROPIC_API_KEY=sk-ant-...
X_LENS_PROVIDER=anthropic
```

Get your key at https://console.anthropic.com/settings/keys

### AWS Bedrock

Option A — AWS profile:
```env
AWS_PROFILE=your-profile-name
AWS_REGION=us-east-1
X_LENS_PROVIDER=bedrock
```

Option B — Access keys:
```env
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
X_LENS_PROVIDER=bedrock
```

Make sure your AWS account has Bedrock model access enabled for Claude models in the specified region.

### OpenRouter (open source models)

```env
OPENROUTER_API_KEY=sk-or-...
X_LENS_PROVIDER=openrouter
# Default model: qwen/qwen3-235b-a22b
# Override with any model from openrouter.ai:
# X_LENS_MODEL=qwen/qwen3-235b-a22b
```

Get your key at https://openrouter.ai/keys

### Groq (fast open source inference)

```env
GROQ_API_KEY=gsk_...
X_LENS_PROVIDER=groq
# Default model: qwen/qwen3-32b
```

Get your key at https://console.groq.com/keys. Free tier available.

### MCP Servers (for skills)

Some skills use MCP servers for data access:

```env
MCP_OI_EXECUTABLE=/path/to/mcp-openinterest-server
MCP_MARKET_DATA_EXECUTABLE=/path/to/mcp-market-data-server
```

### All Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `X_LENS_PROVIDER` | No | Provider: `bedrock`, `anthropic`, `openrouter`, or `groq` (default: `bedrock`) |
| `X_LENS_MODEL` | No | Model ID override (provider-specific, see examples above) |
| `ANTHROPIC_API_KEY` | If using anthropic | Anthropic API key |
| `AWS_PROFILE` | If using bedrock | AWS CLI profile name |
| `AWS_ACCESS_KEY_ID` | If using bedrock (no profile) | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | If using bedrock (no profile) | AWS secret key |
| `AWS_REGION` | If using bedrock | AWS region (default: `us-east-1`) |
| `OPENROUTER_API_KEY` | If using openrouter | OpenRouter API key |
| `GROQ_API_KEY` | If using groq | Groq API key |
| `FMP_API_KEY` | For ~25 trader skills | Financial Modeling Prep API key ([get one here](https://financialmodelingprep.com/developer/docs)) |
| `ALPACA_API_KEY` | For portfolio-manager skill | Alpaca trading API key |
| `ALPACA_API_SECRET` | For portfolio-manager skill | Alpaca trading API secret |
| `FINVIZ_EMAIL` | No | FINVIZ Elite email (optional, improves dividend screeners) |
| `FINVIZ_PASSWORD` | No | FINVIZ Elite password |
| `MCP_OI_EXECUTABLE` | For OI analysis skill | Path to MCP open interest server binary |
| `MCP_MARKET_DATA_EXECUTABLE` | For market data skill | Path to MCP market data server binary |
| `X_LENS_TELEGRAM_TOKEN` | If using --telegram | Telegram bot token from @BotFather |
| `X_LENS_TELEGRAM_GROUP_ID` | If using --telegram | Telegram group chat ID |
| `X_LENS_TELEGRAM_ALLOWLIST` | No | Comma-separated Telegram user IDs (empty = allow all in group) |
| `X_LENS_TELEGRAM_BOT_USERNAME` | No | Bot username without @ (default: xlens_bot) |

## Usage

### Command mode

Run a single task and exit:

```bash
x-lens "find the cheapest flight to NYC next weekend"
x-lens --persona trader "scan for VCP breakout setups in the S&P 500"
x-lens --persona predictor "what are the odds Bitcoin hits 150K this year?"
x-lens "check my gmail for anything urgent"
```

### REPL mode

Start an interactive conversation:

```bash
x-lens --persona trader
> what's the market regime today?
[agent checks VIX, SPY trend, breadth — classifies regime]
> analyze SPY open interest
[agent runs OI analysis across 30/60/90 DTE]
> exit
```

### Options

```
x-lens [options] [command] [prompt]

Options:
  --visible              Show browser window (default: headless)
  --provider <provider>  AI provider: bedrock, anthropic, openrouter, or groq (default from .env)
  --model <model>        Override model ID
  --persona <persona>    Persona to activate (e.g., trader, predictor)
  --new                  Start a new session (clear conversation history)
  -p, --pipe             Pipe mode: stdin/stdout, no TUI (works with claude -p)
  -V, --version          Output version number
  -h, --help             Display help

Commands:
  dashboard [--port]     Start the Hive dashboard (control plane)
  daemon                 Manage the background daemon (start, stop, status, logs, install, uninstall)
```

### Examples

```bash
# Use the trader persona
x-lens --persona trader

# Use the predictor persona
x-lens --persona predictor "find mispriced prediction markets"

# Use Anthropic instead of Bedrock
x-lens --provider anthropic "summarize this article at <url>"

# Use open source models via OpenRouter
x-lens --provider openrouter "summarize this article at <url>"

# Use Groq for fast inference
x-lens --provider groq --persona job-finder "find senior engineer roles in Seattle"

# Watch the browser work
x-lens --visible "log into my bank and check my balance"

# Start fresh session (discard previous conversation)
x-lens --new
```

## Daemon (24/7 Autonomous Agent)

The daemon runs x-lens in the background as an always-on autonomous agent. It monitors markets, executes scheduled tasks, learns from results, and sends macOS notifications when it finds actionable trades.

### Quick Start

```bash
# Start the daemon for a specific persona (foreground — see output live)
x-lens daemon start --persona trader

# Default persona is "trader" if not specified
x-lens daemon start

# Use Anthropic instead of Bedrock
x-lens daemon start --persona trader --provider anthropic
```

The daemon only runs jobs for the specified persona. On first start with `--persona trader`, it seeds 7 default jobs covering the full US trading day:

| Job | Schedule (ET) | What it does |
|-----|---------------|--------------|
| Pre-market briefing | 8:00 AM Mon–Fri | Futures, overnight gaps, macro calendar |
| OI scan | 8:30 AM Mon–Fri | Open interest analysis across SPY/QQQ/IWM |
| Earnings watch | 9:00 AM Mon–Fri | Today's earnings plays, IV crush setups |
| Sector rotation | 10:00 AM Mon–Fri | Sector strength ranking, rotation signals |
| Breakout screener | 11:00 AM Mon–Fri | VCP, cup-and-handle, flag setups |
| Regime check | Every 60 min | VIX regime, trend classification |
| EOD summary | 4:15 PM Mon–Fri | Daily P&L, key levels, next-day plan |

### Managing the Daemon

```bash
# Check if daemon is running + list jobs
x-lens daemon status

# Stop the daemon
x-lens daemon stop

# View live logs
x-lens daemon logs
x-lens daemon logs -n 100    # show last 100 lines
```

### Auto-Start on Boot (macOS)

```bash
# Install as launchd service — auto-starts on boot, auto-restarts on crash
x-lens daemon install

# Remove the launchd service
x-lens daemon uninstall
```

This creates `~/Library/LaunchAgents/com.x-lens.daemon.plist` with `KeepAlive` and `RunAtLoad`.

### Notifications

The agent marks actionable findings with `[ALERT]` in its output. The daemon detects these and sends **macOS native notifications** (via `osascript`). You'll get notified for things like:

- Market regime changes (e.g., VIX spike above 20)
- Breakout setups in your watchlist
- Unusual open interest activity
- Earnings surprises

### Telegram Integration

Connect the daemon to a Telegram group so you can message the agent and receive alerts.

**Setup:**

1. **Create the bot:**
   - Open Telegram and message [@BotFather](https://t.me/botfather)
   - Send `/newbot`
   - BotFather will ask for a display name — enter something like `x-lens`
   - BotFather will ask for a username (must end in `bot`) — enter something like `xlens_bot`
   - BotFather replies with your **bot token** (looks like `123456789:ABCdefGHI-jklMNOpqrSTUvwxYZ`) — save this

2. **Disable privacy mode** (so the bot can see group messages):
   - Message @BotFather → `/setprivacy`
   - Select your bot
   - Choose `Disable`

3. **Create a group and add the bot:**
   - Create a new Telegram group
   - Add your bot (`@xlens_bot`) as a member

4. **Get your group chat ID:**
   - Add [@userinfobot](https://t.me/userinfobot) to the group — it will reply with the group's chat ID (a negative number like `-100xxxxxxxxxx`)
   - You can remove @userinfobot from the group after

5. **Get your Telegram user ID:**
   - Message [@userinfobot](https://t.me/userinfobot) directly — it replies with your user ID

6. **Configure in `.env`:**

```env
X_LENS_TELEGRAM_TOKEN=123456:ABC-DEF...
X_LENS_TELEGRAM_GROUP_ID=-100xxxxxxxxxx
X_LENS_TELEGRAM_ALLOWLIST=your_user_id
X_LENS_TELEGRAM_BOT_USERNAME=xlens_bot
```

7. Start the daemon with `--telegram`:

```bash
x-lens daemon start --persona trader --telegram
```

**Usage in group:**

- `@xlens_bot scan for VCP breakout setups` — send a task
- `@xlens_bot /persona list` — list available personas
- `@xlens_bot /persona job-finder` — switch persona
- `@xlens_bot /status` — check daemon status

Daemon job alerts are automatically posted to the group.

### Agent-Driven Scheduling

The agent manages its own schedule. It has three tools:

| Tool | Description |
|------|-------------|
| `schedule_create` | Create a new job (cron, interval, or continuous) |
| `schedule_delete` | Remove a job |
| `schedule_list` | List all jobs with status |

Job types:
- **cron** — standard cron expression (e.g., `30 6 * * 1-5` for 6:30 AM weekdays)
- **interval** — every N minutes
- **continuous** — loop with a pause between runs

The agent can create new jobs, delete old ones, and adapt its monitoring based on what it learns. Jobs persist in `~/.x-lens/jobs.json`.

### Per-Persona Isolation

Each persona is fully isolated across five dimensions:

- **Browser profile** — each persona gets its own Chromium profile (`~/.x-lens/browser-profiles/<persona>/`), so cookies, auth state, and localStorage never collide between personas.
- **Session history** — each persona gets its own session file (`~/.x-lens/sessions/<persona>.jsonl`). The daemon resumes context across restarts.
- **System prompt** — each persona has its own identity and instructions, focused and token-efficient.
- **Skills loaded** — only the persona's skills (plus global) are loaded. No cross-contamination.
- **Scheduled jobs** — when the agent calls `schedule_create`, the system auto-fills the persona from runtime context. Jobs are dispatched to the correct persona's agent instance.

## Hive (Structured Data Accumulation)

The Hive is a persistent SQLite database (`~/.x-lens/hive.db`) that accumulates structured observations over time. The agent decides what to record — you talk, it captures what matters.

### How it works

1. **You run the trader daily** — via REPL, CLI, pipe, or daemon
2. **Agent records findings** — regime checks, trade signals, observations go into the hive via `hive_record`
3. **Next run: agent validates** — calls `hive_pending` to find yesterday's predictions, checks current data, marks outcomes via `hive_validate`
4. **Patterns emerge** — after enough validations, the agent computes win rates and saves patterns via `hive_pattern_upsert`

### Hive tools (7)

| Tool | Description |
|------|-------------|
| `hive_record` | Record any structured event (type, category, ticker, data, confidence, tags — all optional) |
| `hive_query` | Query events by date range, type, category, ticker, validation status |
| `hive_validate` | Mark a past event with any outcome (correct, incorrect, early, late, etc.) |
| `hive_pending` | Get events due for validation |
| `hive_stats` | Overall stats: total events, accuracy rate, outcome breakdown |
| `hive_patterns` | Query learned patterns with win rates |
| `hive_pattern_upsert` | Create or update a pattern |

### Schema

The hive schema is intentionally loose — every column is optional or has a default. The agent decides what structure fits:

- **type** — any string: `regime_check`, `signal`, `trade`, `news`, `earnings`, `note`, etc.
- **category** — any string for grouping
- **outcome** — any string: `correct`, `incorrect`, `partial`, `early`, `missed`, etc.
- **data** — freeform JSON blob
- **tags** — comma-separated freeform tags

### Example timeline

```
Day 1: regime_check — VIX 18, GREEN, breadth 62% (confidence: 0.85)
       signal — NVDA breakout above 950, target 1050 (confidence: 0.72)

Day 2: [validation] NVDA signal → correct (hit 1050 in 3 days)
       regime_check — VIX 22, YELLOW, breadth declining

Day 30: pattern — "regime classifier 85% accurate over 30 samples"
        pattern — "breakout signals work in GREEN regime, fail in RED"
```

## Dashboard (Control Plane)

A local web UI for monitoring everything x-lens does.

```bash
x-lens dashboard                  # http://localhost:3456
x-lens dashboard --port 4000      # custom port
```

### Tabs

| Tab | What it shows |
|-----|---------------|
| **Timeline** | Hive events grouped by date, color-coded by validation status (green/red/amber/grey) |
| **Runs** | Every CLI/daemon/pipe execution with prompt, response, duration, tool count |
| **Simulations** | All simulation runs with scenario, agent/action counts, full reports |
| **Patterns** | Pending validations + learned patterns with win rates |

### Stats bar

Total events, accuracy %, pending validations, run count, simulation count, pattern count. Auto-refreshes every 30 seconds.

### What gets captured automatically

| Source | Captured |
|--------|----------|
| `x-lens "prompt"` (CLI) | Run with prompt, response, duration, status |
| `x-lens -p` (pipe) | Same |
| Daemon scheduled jobs | Same + job ID |
| `x-lens --persona trader` (REPL) | Session start/end |
| Simulations | Scenario, agents, actions, report (synced from `~/.x-lens/simulations/`) |

Hive events are NOT auto-captured — the agent decides what to record using `hive_record`.

## Pipe Mode

Run x-lens as a composable CLI tool. No TUI, no browser screenshots to terminal — raw text output to stdout.

```bash
# From argument
x-lens -p "check market regime" --persona trader

# From stdin
echo "validate yesterday's signals" | x-lens -p --persona trader

# Compose with claude -p
claude -p "run: x-lens -p 'trader regime check' and summarize"

# Use in scripts
REGIME=$(x-lens -p "what is the current market regime? reply with just GREEN, YELLOW, or RED" --persona trader)
echo "Current regime: $REGIME"
```

## Simulation Engine (Market Sentiment Simulator)

The trader persona includes a multi-agent social simulation engine that models how market narratives propagate across Twitter and Reddit. It uses the [OASIS framework](https://github.com/camel-ai/oasis) with LLM-powered agents.

### Simulation Setup

The simulation engine lives in `simulation/` and has its own Python virtualenv and `.env` file.

```bash
# 1. Create the virtualenv
cd simulation
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 2. Configure simulation/.env
cp .env.example .env
# Edit simulation/.env with your LLM credentials (see below)
```

### Simulation Environment Variables

Create `simulation/.env` with these variables:

```env
# LLM provider for agent profile generation, config generation, and report generation
# Uses LiteLLM — supports OpenAI, Anthropic, Bedrock, OpenRouter, Ollama, etc.

# Option A: OpenRouter (recommended — access to many models)
LLM_MODEL_NAME=bytedance-seed/seed-2.0-mini
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=sk-or-...

# Option B: OpenAI
# LLM_MODEL_NAME=gpt-4o-mini
# LLM_API_KEY=sk-...

# Option C: Anthropic
# LLM_MODEL_NAME=anthropic/claude-haiku-4-5-20251001
# ANTHROPIC_API_KEY=sk-ant-...

# Option D: AWS Bedrock
# LLM_MODEL_NAME=bedrock/anthropic.claude-haiku-4-5-20251001
# AWS_ACCESS_KEY_ID=AKIA...
# AWS_SECRET_ACCESS_KEY=...
# AWS_REGION=us-east-1

# Option E: Ollama (local, free)
# LLM_MODEL_NAME=ollama/llama3
# LLM_BASE_URL=http://localhost:11434/v1
```

The simulation also reads from the root `.env` as a fallback, so if you already have `OPENROUTER_API_KEY` set in the root `.env`, you only need `LLM_MODEL_NAME` and `LLM_BASE_URL` in `simulation/.env`.

### Skill Absolute Paths

The simulation skill (`skills/trader/market-sentiment-simulator/skill.md`) contains **hardcoded absolute paths** to the simulation directory and virtualenv. If you clone the repo to a different location, update these paths in the skill file:

```
Simulation package: /your/path/to/x-lens/simulation
```

Also update the `simulate.sh` script path in the skill file accordingly. The script itself resolves paths relative to its own location, so it doesn't need editing.

### Running a Simulation

**Via x-lens CLI (end-to-end):**

```bash
x-lens --persona trader --provider openrouter \
  "Search for latest NVIDIA news, then run a market sentiment simulation"
```

The agent will search for news, read the skill instructions, and call `simulate.sh` which handles everything.

**Via simulate.sh directly:**

```bash
./simulation/simulate.sh \
  --scenario "NVIDIA reports Q1 earnings beating estimates by 15%, but issues cautious guidance on China export restrictions. Stock drops 8% after hours." \
  --count 10 \
  --max-rounds 30 \
  --platform twitter \
  --port 5055
```

**Dashboard:** Opens at `http://localhost:5055` showing live pipeline progress, agent feed, and the generated report. Parallel simulations reuse the same dashboard — a sim picker lets you switch between running and completed sims.

**Flags:**

| Flag | Description |
|------|-------------|
| `--fact-check` | Enable automatic fact-checking of agent posts via Nova web grounding |
| `--fact-check-rate 0.5` | Fraction of posts to fact-check (0.0-1.0, saves API cost) |
| `--web-search` | Enable agents to search the web during simulation |
| `--context-file path` | Inject raw market data (OI, news, regime) into agent context |
| `--seed-posts path` | Provide hand-crafted seed posts instead of LLM-generated ones |

### Simulation Output

Simulations are saved to `~/.x-lens/simulations/<sim_id>/`:

| File | Description |
|------|-------------|
| `profiles.json` | Generated agent personas with sentiment biases |
| `simulation_config.json` | Timing, seed posts, hot topics |
| `actions.jsonl` | Every agent action (posts, likes, reposts, follows) |
| `twitter_simulation.db` | Full OASIS SQLite database |
| `report.md` | LLM-generated analysis report |

## Job-Finder Persona

The `job-finder` persona searches LinkedIn for hiring posts and saves ranked results.

### Setup

1. Create LinkedIn credentials file:
```bash
echo "email=your@email.com" > ~/.x-lens/.linkedin-creds
echo "password=yourpassword" >> ~/.x-lens/.linkedin-creds
```

2. Log in manually once (for 2FA/CAPTCHA):
```bash
x-lens --persona job-finder --visible
# Then say: "Log into LinkedIn"
```

3. Create a search job:
```bash
x-lens --persona job-finder "find posts about hiring senior+ backend engineers at FAANG in Seattle"
```

4. Or run as daemon:
```bash
x-lens daemon start --persona job-finder
```

### Results

Results are saved to `~/.x-lens/linkedin-posts.jsonl` — one JSON object per line with author, company, text, URL, relevance score, and ranking reason.

Browse results in your browser at **http://localhost:3456/jobs** — a sortable, searchable table with expandable rows and "View on LinkedIn" links.

### Skills

| Skill | Purpose |
|-------|---------|
| `linkedin-search` | Decompose prompts into search queries |
| `post-extraction` | Extract structured data from LinkedIn DOM |
| `post-ranking` | Score and rank posts by relevance |
| `linkedin-login` | Handle authentication and 2FA |

## Closed Learning Loop

x-lens has a built-in learning loop — it saves knowledge from experience, recalls past sessions, and creates skills autonomously.

### Three Memory Layers

| Layer | File | Purpose |
|-------|------|---------|
| **Memory** | `~/.x-lens/MEMORY.md` | Environment and project facts — tool quirks, API conventions, codebase patterns |
| **User Profile** | `~/.x-lens/USER.md` | Who you are — preferences, communication style, expertise, timezone, workflow habits |
| **Session History** | `~/.x-lens/sessions.db` | SQLite database with FTS5 full-text search across all past conversations |

### Autonomous Behaviors

The agent proactively saves learnings without being asked:

- **Corrected?** Saves the correction to memory or user profile so it doesn't repeat the mistake
- **Complex task succeeded?** Creates a reusable skill from the workflow (5+ tool calls)
- **Skill outdated?** Patches it immediately during use
- **User references prior work?** Searches past sessions via FTS5 before asking them to repeat

### Session Search

All conversations are stored in SQLite with full-text search. The agent uses the `session_search` tool to recall past context:

```
> remember when we fixed that Docker issue?
[agent searches sessions.db, finds matching conversation, returns context]
```

### Self-Improving Skills

The agent can create and improve skills from experience:

- `skill_create` — saves a successful workflow as a reusable skill in `~/.x-lens/skills/`
- `skill_patch` — updates an existing skill when it finds issues during use
- User-created skills are loaded alongside repo skills (lowest priority, no override)

## Memory & Persistence

x-lens stores persistent data in `~/.x-lens/`:

| What | Path | Description |
|------|------|-------------|
| **Hive DB** | `~/.x-lens/hive.db` | Structured time-series data: events, patterns, runs, simulations. The core data layer. |
| Memory | `~/.x-lens/MEMORY.md` | Agent's long-term memory — environment facts, tool quirks, project patterns. |
| User Profile | `~/.x-lens/USER.md` | User preferences, expertise, communication style, role. |
| Session DB | `~/.x-lens/sessions.db` | SQLite + FTS5 database of all past conversations (searchable). |
| Session (REPL) | `~/.x-lens/sessions/context.jsonl` | REPL conversation history. Resumed on next run. Use `--new` to clear. |
| Session (daemon) | `~/.x-lens/sessions/<persona>.jsonl` | Per-persona daemon sessions. Persist across daemon restarts. |
| User Skills | `~/.x-lens/skills/` | Agent-created skills from successful workflows. |
| Jobs | `~/.x-lens/jobs.json` | Agent-managed scheduled jobs for the daemon. |
| Daemon log | `~/.x-lens/daemon.log` | Daemon stdout/stderr when running via launchd. |
| Browser profiles | `~/.x-lens/browser-profiles/<persona>/` | Per-persona Chromium profiles — cookies, auth, localStorage isolated per persona. |
| OI cache | `~/.x-lens/oi-cache/` | Cached open interest data for day-over-day delta calculations. |
| LinkedIn posts | `~/.x-lens/linkedin-posts.jsonl` | Job-finder results — one JSON object per line with author, company, text, URL, relevance score, and ranking reason. |
| Simulations | `~/.x-lens/simulations/<sim_id>/` | Simulation outputs — profiles, config, actions, database, and report. |

The agent can read and write its own memory during a session. It will remember things like your preferences, frequently used sites, and useful context across conversations.

## Status Page

When running, a status page is available at **http://localhost:3456** showing:
- Live agent activity
- Browser screenshots
- Tool usage logs
- Errors

Additional pages:
- **/jobs** — browse LinkedIn hiring post results (sortable table, search, expandable rows, "View on LinkedIn" links)

If port 3456 is busy, it automatically tries the next available port (up to 3465).

## Tools

The agent has 28 tools available:

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to a URL |
| `browser_screenshot` | Take a screenshot of current page |
| `browser_click` | Click an element by CSS selector |
| `browser_type` | Type text into an input element |
| `browser_scroll` | Scroll the page up or down |
| `browser_evaluate` | Execute JavaScript in page context |
| `web_search` | Search Google and return results |
| `shell` | Execute shell commands |
| `fetch` | Make HTTP requests |
| `memory_read` | Read persistent memory |
| `memory_write` | Write/replace persistent memory |
| `memory_append` | Append to persistent memory |
| `user_write` | Write/replace user profile |
| `user_append` | Append to user profile |
| `session_search` | Search past conversations via FTS5 |
| `skill_read` | Load a skill's full instructions |
| `skill_create` | Create a new skill from experience |
| `skill_patch` | Update an existing skill's instructions |
| `schedule_create` | Create a scheduled job (cron/interval/continuous) |
| `schedule_delete` | Delete a scheduled job |
| `schedule_list` | List all scheduled jobs with status |
| `hive_record` | Record a structured event to the Hive |
| `hive_query` | Query Hive events by date, type, ticker, etc. |
| `hive_validate` | Mark a past event with its outcome |
| `hive_pending` | Get events due for validation |
| `hive_stats` | Hive statistics and accuracy rates |
| `hive_patterns` | Query learned patterns |
| `hive_pattern_upsert` | Create or update a pattern |

## Project Structure

The backend uses [pi-mom](https://github.com/nicholasgasior/pi-mom).

```
x-lens/
├── ai/              # LLM abstraction (Anthropic, Bedrock, 20+ providers)
├── agent/           # Agent loop, events, tool system
├── tui/             # Terminal UI framework
├── app/             # x-lens application
│   └── src/
│       ├── main.ts            # CLI entry point (command, repl, pipe, dashboard, daemon)
│       ├── runner.ts          # Command/pipe mode (single task)
│       ├── repl.ts            # Interactive REPL with session persistence
│       ├── browser.ts         # Playwright browser controller
│       ├── tools.ts           # 28 agent tools (browser, shell, fetch, memory, skills, scheduling, hive)
│       ├── hive.ts            # Hive DB — structured events, patterns, runs, simulations
│       ├── dashboard.ts       # Hive dashboard — control plane web UI
│       ├── thread-manager.ts  # Multi-threaded agent execution (concurrent daemon jobs)
│       ├── skills.ts          # Skill loader with persona support + user-created skills
│       ├── memory.ts          # Memory & user profile persistence
│       ├── session-store.ts   # SQLite + FTS5 session store for cross-session search
│       ├── daemon.ts          # Background daemon with multi-threaded job scheduling
│       ├── job-store.ts       # Persistent job store (~/.x-lens/jobs.json)
│       ├── session-manager.ts # Per-persona session persistence
│       ├── compaction.ts      # Context window compaction for long sessions
│       ├── notify.ts          # macOS native notifications
│       ├── render.ts          # Terminal markdown rendering
│       └── status-server.ts   # Live monitoring page
├── skills/          # All skills (global + per-persona)
│   ├── global/      # Always loaded
│   ├── trader/      # Trading & market analysis skills
│   ├── predictor/   # Prediction market skills
│   └── job-finder/  # LinkedIn hiring post search & ranking
├── simulation/      # Multi-agent social simulation engine
│   ├── src/         # Python modules (generate_profiles, run_simulation, etc.)
│   ├── dashboard/   # Live monitoring dashboard (HTML + JS)
│   ├── simulate.sh  # All-in-one runner script
│   └── .env         # Simulation LLM credentials (separate from root .env)
├── .env             # Credentials (git-ignored)
└── .env.example     # Credential template
```

## Development

```bash
# Rebuild all packages
npm run build

# Rebuild just the app
cd app && npm run build

# Run tests
cd app && npx vitest run

# Clean build
npm run clean && npm run build
```

## How It Works

1. You give the agent a task (via CLI, REPL, pipe, or daemon schedule)
2. The agent detects the active persona and loads the corresponding skills (repo + user-created)
3. It matches your intent to a skill via triggers and description, or handles it freestyle
4. It uses its tools to accomplish the task:
   - **Browser** — navigate, click, type, scroll, screenshot, evaluate JS, web search
   - **Shell** — run commands and scripts
   - **Fetch** — HTTP requests for APIs
   - **Memory** — read/write persistent notes across sessions
   - **Session Search** — recall context from past conversations via FTS5
   - **Hive** — record structured findings, validate past predictions, query patterns
5. The browser uses a persistent Chrome profile, so it stays logged into your accounts
6. Sessions are preserved in SQLite — pick up where you left off, or use `--new` to start fresh
7. The agent autonomously saves learnings (memory, user profile, skills) and records structured data to the Hive
8. Every execution is captured in the Hive runs table — visible in the dashboard
9. Over time, the Hive accumulates a timeline of observations with validation tracking and pattern recognition

## Disclaimer

x-lens is a personal project built for educational purposes only.

**Trading:** The trading skills and market analysis outputs are for informational and educational purposes only. Do not make investment decisions based solely on this agent's output. Always do your own research and consult a qualified financial advisor before trading.

**Job search:** The job finder persona automates browsing of publicly visible LinkedIn posts. It does not bypass any access controls or scrape private data. Use responsibly and in compliance with LinkedIn's terms of service. Results are not guaranteed to be complete or accurate.

**Prediction markets:** The predictor persona analyzes publicly available prediction market data. It does not place bets or execute trades on your behalf unless explicitly instructed. Prediction market participation may be subject to legal restrictions in your jurisdiction. Do your own research before placing any positions.

This software is provided as is with no warranty of any kind. The author assumes no liability for any financial losses, legal issues, missed opportunities, or other damages arising from the use of this software or any of its personas and skills. Use entirely at your own risk.
