<p align="center">
  <img src="logo.svg" alt="x-lens logo" width="180" />
</p>

# x-lens

A skills-based personal agent with browser capabilities. Built on a stripped-down fork of [pi-toolkit](https://github.com/nichochar/pi-toolkit).

x-lens can browse the web autonomously (navigate, click, type, screenshot), run shell commands, make HTTP requests, and follow user-defined skills — all driven by an LLM.

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
└── predictor/           # --persona predictor (1 skill)
    └── prediction-markets/  
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

### MCP Servers (for skills)

Some skills use MCP servers for data access:

```env
MCP_OI_EXECUTABLE=/path/to/mcp-openinterest-server
MCP_MARKET_DATA_EXECUTABLE=/path/to/mcp-market-data-server
```

### All Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `X_LENS_PROVIDER` | No | Default provider: `bedrock` or `anthropic` (default: `bedrock`) |
| `ANTHROPIC_API_KEY` | If using anthropic | Anthropic API key |
| `AWS_PROFILE` | If using bedrock | AWS CLI profile name |
| `AWS_ACCESS_KEY_ID` | If using bedrock (no profile) | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | If using bedrock (no profile) | AWS secret key |
| `AWS_REGION` | If using bedrock | AWS region (default: `us-east-1`) |
| `MCP_OI_EXECUTABLE` | For OI analysis skill | Path to MCP open interest server binary |
| `MCP_MARKET_DATA_EXECUTABLE` | For market data skill | Path to MCP market data server binary |

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
x-lens [options] [prompt]

Options:
  --visible              Show browser window (default: headless)
  --provider <provider>  AI provider: bedrock or anthropic (default from .env)
  --model <model>        Override model ID
  --persona <persona>    Persona to activate (e.g., trader, predictor)
  --new                  Start a new session (clear conversation history)
  -V, --version          Output version number
  -h, --help             Display help
```

### Examples

```bash
# Use the trader persona
x-lens --persona trader

# Use the predictor persona
x-lens --persona predictor "find mispriced prediction markets"

# Use Anthropic instead of Bedrock
x-lens --provider anthropic "summarize this article at <url>"

# Watch the browser work
x-lens --visible "log into my bank and check my balance"

# Start fresh session (discard previous conversation)
x-lens --new
```

## Memory & Persistence

x-lens stores persistent data in `~/.x-lens/`:

| What | Path | Description |
|------|------|-------------|
| Memory | `~/.x-lens/MEMORY.md` | Agent's long-term memory — preferences, URLs, recurring info. Read at startup, written via `memory_write`/`memory_append` tools. |
| Session | `~/.x-lens/sessions/context.jsonl` | Conversation history (JSONL). Automatically resumed on next run. Use `--new` to clear. |
| Browser profile | `~/.x-lens/browser-profile/` | Persistent Chromium profile — cookies, auth, localStorage survive across runs. |
| OI cache | `~/.x-lens/oi-cache/` | Cached open interest data for day-over-day delta calculations. |

The agent can read and write its own memory during a session. It will remember things like your preferences, frequently used sites, and useful context across conversations.

## Status Page

When running, a status page is available at **http://localhost:3456** showing:
- Live agent activity
- Browser screenshots
- Tool usage logs
- Errors

If port 3456 is busy, it automatically tries the next available port (up to 3465).

## Tools

The agent has 12 tools available:

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

## Project Structure

```
x-lens/
├── ai/              # LLM abstraction (Anthropic, Bedrock, 20+ providers)
├── agent/           # Agent loop, events, tool system
├── tui/             # Terminal UI framework
├── app/             # x-lens application
│   └── src/
│       ├── main.ts          # CLI entry point
│       ├── runner.ts        # Command mode (single task)
│       ├── repl.ts          # Interactive REPL with session persistence
│       ├── browser.ts       # Playwright browser controller
│       ├── tools.ts         # Agent tools (browser, shell, fetch, memory)
│       ├── skills.ts        # Skill loader with persona support
│       ├── memory.ts        # Memory & session persistence
│       ├── render.ts        # Terminal markdown rendering
│       └── status-server.ts # Live monitoring page
├── skills/          # All skills (global + per-persona)
│   ├── global/      # Always loaded
│   ├── trader/      # Trading & market analysis skills
│   └── predictor/   # Prediction market skills
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

1. You give the agent a task (via CLI or REPL)
2. The agent detects the active persona and loads the corresponding skills
3. It matches your intent to a skill via triggers and description, or handles it freestyle
4. It uses its tools to accomplish the task:
   - **Browser** — navigate, click, type, scroll, screenshot, evaluate JS, web search
   - **Shell** — run commands and scripts
   - **Fetch** — HTTP requests for APIs
   - **Memory** — read/write persistent notes across sessions
5. The browser uses a persistent Chrome profile, so it stays logged into your accounts
6. Sessions are preserved — pick up where you left off, or use `--new` to start fresh
7. The agent reports back with results rendered as rich terminal markdown
