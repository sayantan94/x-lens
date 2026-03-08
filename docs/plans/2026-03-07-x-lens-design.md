# x-lens Design

A skills-based personal agent built on a stripped-down pi-toolkit fork. General-purpose agent with browser capabilities, NLP-driven skill selection, and CLI interface.

## Structure

```
x-lens/
├── ai/                          # LLM abstraction (Claude, Bedrock)
├── agent/                       # Agent loop, events, tool system
├── tui/                         # Terminal UI
├── app/                         # The agent application
│   ├── src/
│   └── package.json
├── skills/                      # Drop-in skills (md files or folders with scripts)
└── package.json                 # Monorepo root
```

## Origin

- **pi-toolkit fork** (clean break) — keep `ai`, `agent`, `tui`. Remove `coding-agent`, `mom`, `web-ui`, `pods`.
- **openclaw patterns** — browser control approach (Playwright, screenshots, a11y tree reasoning, Chrome profile management).

## Agent Loop

1. User gives a task (CLI command or REPL)
2. Agent matches intent to a skill via NLP (or handles freestyle)
3. LLM receives: system prompt + skill context + conversation
4. LLM decides which tools to call
5. Tools execute, results go back to LLM
6. Loop until task is done

### Browser Reasoning Loop

When using browser tools:

1. Agent navigates to a page
2. Takes screenshot + accessibility tree snapshot
3. LLM sees the page, decides next action
4. Executes action (click, type, scroll)
5. New screenshot → loop until sub-task is done

## Tools

- **Browser** — navigate, click, type, fill, screenshot, scroll, extract, evaluate JS (Playwright, patterns from openclaw)
- **File** — read, write (for saving results, managing state)
- **Shell** — run scripts/commands
- **Fetch** — direct HTTP requests when browser isn't needed

## Browser

- Playwright-controlled Chromium
- Persistent Chrome profile (stays logged into accounts across sessions)
- Headless by default, `--visible` flag to show browser window
- Screenshot + accessibility tree snapshots for LLM reasoning
- Navigation guards (SSRF protection)

## Skill System

Skills are markdown files or folders dropped into `skills/`. Auto-discovered, NLP-matched to user intent.

### Single-file skill

```markdown
# skills/check-email.md
---
name: check-email
description: Check email for urgent messages
triggers: [email, gmail, inbox, urgent mail]
---

## Instructions
1. Open browser to gmail.com
2. Look for unread messages
3. Summarize anything urgent
4. Report back to user
```

### Folder skill (with scripts)

```
skills/deploy-site/
├── skill.md
├── deploy.sh
└── validate.py
```

The agent reads the skill instructions and executes bundled scripts as part of the workflow.

### Discovery

- All `skills/*.md` and `skills/*/skill.md` loaded on startup
- New skills picked up automatically — no registration, no config, no restart
- Agent matches user intent against skill descriptions/triggers using NLP
- If no skill matches, agent handles it freestyle

## CLI Interface

### Command mode

```
x-lens "find the cheapest flight to NYC next weekend"
x-lens --visible "fill out the form at example.com"
```

### REPL mode

```
x-lens
> check my gmail for anything urgent
> now reply to the one from John saying I'll be there
```

### Flags

- `--visible` — show browser window (default: headless)
- `--model` — override model (default: Bedrock/Claude)

## Status Page

Simple web view showing:
- What the agent is doing
- Browser screenshots
- Logs
- Results

## Defaults

- **Model**: Claude via Bedrock
- **Browser**: headless
- **Skills**: auto-discovered from `skills/`

## What We Remove from pi-toolkit

- `coding-agent` package
- `mom` package
- `web-ui` package
- `pods` package
- Coding tools (read/write/edit/grep/find/ls as coding-specific tools)

## What We Take from openclaw

- Browser control patterns (Playwright integration)
- Screenshot + a11y tree reasoning approach
- Chrome profile management
- Navigation guards
