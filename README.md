<p align="center">
  <img src="logo.svg" alt="x-lens logo" width="180" />
</p>

# x-lens

A skills-based personal agent with browser capabilities. Built on a stripped-down fork of [pi-toolkit](https://github.com/nichochar/pi-toolkit).

x-lens can browse the web autonomously (navigate, click, type, screenshot), run shell commands, make HTTP requests, and follow user-defined skills — all driven by an LLM.

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

### All Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `X_LENS_PROVIDER` | No | Default provider: `bedrock` or `anthropic` (default: `bedrock`) |
| `ANTHROPIC_API_KEY` | If using anthropic | Anthropic API key |
| `AWS_PROFILE` | If using bedrock | AWS CLI profile name |
| `AWS_ACCESS_KEY_ID` | If using bedrock (no profile) | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | If using bedrock (no profile) | AWS secret key |
| `AWS_REGION` | If using bedrock | AWS region (default: `us-east-1`) |

## Usage

### Command mode

Run a single task and exit:

```bash
x-lens "find the cheapest flight to NYC next weekend"
x-lens "check my gmail for anything urgent"
x-lens "take a screenshot of example.com"
```

### REPL mode

Start an interactive conversation:

```bash
x-lens
> check my email
[agent browses gmail, reports back]
> reply to the one from John saying I'll be there
[agent continues in context]
> exit
```

### Options

```
x-lens [options] [prompt]

Options:
  --visible              Show browser window (default: headless)
  --provider <provider>  AI provider: bedrock or anthropic (default from .env)
  --model <model>        Override model ID
  --new                  Start a new session (clear conversation history)
  -V, --version          Output version number
  -h, --help             Display help
```

### Examples

```bash
# Use Anthropic instead of Bedrock
x-lens --provider anthropic "summarize this article at <url>"

# Watch the browser work
x-lens --visible "log into my bank and check my balance"

# REPL with visible browser
x-lens --visible

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

The agent can read and write its own memory during a session. It will remember things like your preferences, frequently used sites, and useful context across conversations.

## Status Page

When running, a status page is available at **http://localhost:3456** showing:
- Live agent activity
- Browser screenshots
- Tool usage logs
- Errors

If port 3456 is busy, it automatically tries the next available port (up to 3465).

## Skills

Skills are markdown files in the `skills/` directory. The agent automatically discovers and uses them based on your request.

### Built-in skills

- **check-email** — Check Gmail for unread/urgent messages
- **search-web** — Search Google and summarize results
- **screenshot-page** — Screenshot a webpage and save it

### Adding a skill

Drop a markdown file in `skills/`:

```markdown
# skills/my-skill.md
---
name: my-skill
description: What this skill does
triggers: [keyword1, keyword2, keyword3]
---

## Instructions

1. Step one
2. Step two
3. Step three
```

Or create a folder with scripts:

```
skills/my-skill/
├── skill.md          # Instructions
├── setup.sh          # Scripts the agent can run
└── process.py        # Any supporting files
```

Skills are picked up automatically — no restart needed.

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
│       ├── skills.ts        # Skill loader & matcher
│       ├── memory.ts        # Memory & session persistence
│       ├── render.ts        # Terminal markdown rendering
│       └── status-server.ts # Live monitoring page
├── skills/          # User-defined skills
├── .env             # Credentials (git-ignored)
└── .env.example     # Credential template
```

## Development

```bash
# Rebuild all packages
npm run build

# Rebuild just the app
cd app && npm run build

# Clean build
npm run clean && npm run build
```

## How It Works

1. You give the agent a task (via CLI or REPL)
2. The agent matches your intent to a skill (if one fits) or handles it freestyle
3. It uses its tools to accomplish the task:
   - **Browser** — navigate, click, type, scroll, screenshot, evaluate JS
   - **Shell** — run commands and scripts
   - **Fetch** — HTTP requests for APIs
   - **Memory** — read/write persistent notes across sessions
4. The browser uses a persistent Chrome profile, so it stays logged into your accounts
5. Sessions are preserved — pick up where you left off, or use `--new` to start fresh
6. The agent reports back with results rendered as rich terminal markdown
