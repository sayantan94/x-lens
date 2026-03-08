# x-lens Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a skills-based personal agent with browser capabilities, forked from pi-toolkit's core.

**Architecture:** Fork pi-toolkit, strip to core packages (ai, agent, tui), flatten to root level, build x-lens app on top with Playwright browser tools (patterns from openclaw), markdown skills with NLP matching, and CLI with REPL + command modes.

**Tech Stack:** TypeScript/ESM, Node 20+, Playwright, pi-agent-core, pi-ai, pi-tui, Bedrock (Claude)

---

### Task 1: Fork and Flatten pi-toolkit

**Goal:** Create a clean fork of pi-toolkit with only the core packages, flattened to root level.

**Step 1: Clone pi-toolkit into x-lens**

Run:
```bash
cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens
git remote add pi-toolkit https://github.com/nichochar/pi-toolkit.git  # or wherever the fork is
# Or simply copy the needed directories
cp -r /Users/sayantan/Documents/Workspace/personal-assist/pi-toolkit/packages/ai ./ai
cp -r /Users/sayantan/Documents/Workspace/personal-assist/pi-toolkit/packages/agent ./agent
cp -r /Users/sayantan/Documents/Workspace/personal-assist/pi-toolkit/packages/tui ./tui
cp -r /Users/sayantan/Documents/Workspace/personal-assist/pi-toolkit/tsconfig.base.json ./
```

**Step 2: Remove unwanted packages**

Do NOT copy: `coding-agent`, `mom`, `web-ui`, `pods`

**Step 3: Create root package.json**

```json
{
  "name": "x-lens",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "workspaces": ["ai", "agent", "tui", "app"],
  "engines": { "node": ">=20.0.0" },
  "scripts": {
    "clean": "npm run clean --workspaces --if-present",
    "build": "cd tui && npm run build && cd ../ai && npm run build && cd ../agent && npm run build && cd ../app && npm run build",
    "dev": "concurrently -n tui,ai,agent,app \"cd tui && npm run dev\" \"cd ai && npm run dev\" \"cd agent && npm run dev\" \"cd app && npm run dev\""
  },
  "devDependencies": {
    "@anthropic-ai/sdk": "^0.52.0",
    "@biomejs/biome": "^2.3.5",
    "concurrently": "^9.2.1",
    "typescript": "^5.9.2",
    "tsx": "^4.20.3"
  }
}
```

**Step 4: Create root tsconfig.json**

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "paths": {
      "@mariozechner/pi-ai": ["./ai/src/index.ts"],
      "@mariozechner/pi-agent-core": ["./agent/src/index.ts"],
      "@mariozechner/pi-tui": ["./tui/src/index.ts"]
    }
  },
  "include": ["ai/src", "agent/src", "tui/src", "app/src"]
}
```

**Step 5: Install dependencies and verify build**

Run:
```bash
npm install
npm run build
```

Expected: All three core packages build without errors.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: initialize x-lens with pi-toolkit core (ai, agent, tui)"
```

---

### Task 2: Create the App Package Scaffold

**Goal:** Create the `app/` package that will be the x-lens agent application.

**Files:**
- Create: `app/package.json`
- Create: `app/tsconfig.build.json`
- Create: `app/src/index.ts`
- Create: `app/src/main.ts`

**Step 1: Create app/package.json**

```json
{
  "name": "@x-lens/app",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "x-lens": "dist/main.js"
  },
  "exports": {
    ".": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "dev": "tsc -p tsconfig.build.json --watch",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@mariozechner/pi-ai": "*",
    "@mariozechner/pi-agent-core": "*",
    "@mariozechner/pi-tui": "*",
    "playwright-core": "^1.58.0",
    "commander": "^14.0.0"
  },
  "devDependencies": {
    "typescript": "^5.9.2"
  }
}
```

**Step 2: Create app/tsconfig.build.json**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

**Step 3: Create app/src/main.ts (entry point)**

```typescript
#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("x-lens")
  .description("Skills-based personal agent with browser capabilities")
  .version("0.1.0")
  .argument("[prompt]", "Task to execute (command mode)")
  .option("--visible", "Show browser window (default: headless)")
  .option("--model <model>", "Override model (default: bedrock claude)")
  .action(async (prompt, options) => {
    if (prompt) {
      // Command mode: execute and exit
      const { runOnce } = await import("./runner.js");
      await runOnce(prompt, options);
    } else {
      // REPL mode: interactive
      const { runInteractive } = await import("./repl.js");
      await runInteractive(options);
    }
  });

program.parse();
```

**Step 4: Create app/src/index.ts (library exports)**

```typescript
export { runOnce } from "./runner.js";
export { runInteractive } from "./repl.js";
```

**Step 5: Commit**

```bash
git add app/
git commit -m "feat: scaffold app package with CLI entry point"
```

---

### Task 3: Build the Browser Controller

**Goal:** Wrap Playwright in a controller that manages a persistent Chrome profile and provides page state (screenshots + accessibility tree) to the agent.

**Files:**
- Create: `app/src/browser.ts`

**Step 1: Write the failing test**

Create `app/src/__tests__/browser.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { BrowserController } from "../browser.js";

describe("BrowserController", () => {
  it("should create with default config", () => {
    const browser = new BrowserController();
    expect(browser).toBeDefined();
    expect(browser.isRunning()).toBe(false);
  });

  it("should resolve profile directory", () => {
    const browser = new BrowserController({ profileDir: "/tmp/test-profile" });
    expect(browser.config.profileDir).toBe("/tmp/test-profile");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/__tests__/browser.test.ts`
Expected: FAIL — module not found

**Step 3: Implement BrowserController**

Create `app/src/browser.ts`:

```typescript
import { chromium, type Browser, type Page, type BrowserContext } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface BrowserConfig {
  headless: boolean;
  profileDir: string;
  executablePath?: string;
}

export interface PageSnapshot {
  screenshot: Buffer;
  accessibilityTree: string;
  url: string;
  title: string;
}

const DEFAULT_PROFILE_DIR = join(homedir(), ".x-lens", "browser-profile");

export class BrowserController {
  readonly config: BrowserConfig;
  private context: BrowserContext | null = null;
  private _page: Page | null = null;

  constructor(opts: Partial<BrowserConfig> = {}) {
    this.config = {
      headless: opts.headless ?? true,
      profileDir: opts.profileDir ?? DEFAULT_PROFILE_DIR,
      executablePath: opts.executablePath,
    };
  }

  isRunning(): boolean {
    return this.context !== null;
  }

  async launch(): Promise<void> {
    if (this.context) return;

    if (!existsSync(this.config.profileDir)) {
      mkdirSync(this.config.profileDir, { recursive: true });
    }

    this.context = await chromium.launchPersistentContext(this.config.profileDir, {
      headless: this.config.headless,
      executablePath: this.config.executablePath,
      viewport: { width: 1280, height: 900 },
      args: ["--disable-blink-features=AutomationControlled"],
    });

    const pages = this.context.pages();
    this._page = pages.length > 0 ? pages[0] : await this.context.newPage();
  }

  get page(): Page {
    if (!this._page) throw new Error("Browser not launched. Call launch() first.");
    return this._page;
  }

  async navigate(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  }

  async screenshot(): Promise<Buffer> {
    return await this.page.screenshot({ type: "png" });
  }

  async accessibilityTree(): Promise<string> {
    return await this.page.accessibility.snapshot().then((s) => JSON.stringify(s, null, 2));
  }

  async snapshot(): Promise<PageSnapshot> {
    const [screenshotBuf, a11y, url, title] = await Promise.all([
      this.screenshot(),
      this.accessibilityTree(),
      Promise.resolve(this.page.url()),
      this.page.title(),
    ]);
    return { screenshot: screenshotBuf, accessibilityTree: a11y, url, title };
  }

  async click(selector: string): Promise<void> {
    await this.page.click(selector, { timeout: 8000 });
  }

  async type(selector: string, text: string): Promise<void> {
    await this.page.fill(selector, text, { timeout: 8000 });
  }

  async press(key: string): Promise<void> {
    await this.page.keyboard.press(key);
  }

  async scroll(direction: "up" | "down", amount: number = 500): Promise<void> {
    const delta = direction === "down" ? amount : -amount;
    await this.page.mouse.wheel(0, delta);
    await this.page.waitForTimeout(300);
  }

  async evaluate(fn: string): Promise<unknown> {
    return await this.page.evaluate(fn);
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this._page = null;
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/__tests__/browser.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add app/src/browser.ts app/src/__tests__/browser.test.ts
git commit -m "feat: add BrowserController with persistent Chrome profile"
```

---

### Task 4: Build Browser Tools for the Agent

**Goal:** Create AgentTool implementations that wrap BrowserController and let the LLM control the browser.

**Files:**
- Create: `app/src/tools.ts`

**Step 1: Write the failing test**

Create `app/src/__tests__/tools.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { createBrowserTools } from "../tools.js";
import { BrowserController } from "../browser.js";

describe("createBrowserTools", () => {
  it("should create all browser tools", () => {
    const browser = new BrowserController();
    const tools = createBrowserTools(browser);
    const names = tools.map((t) => t.name);
    expect(names).toContain("browser_navigate");
    expect(names).toContain("browser_screenshot");
    expect(names).toContain("browser_click");
    expect(names).toContain("browser_type");
    expect(names).toContain("browser_scroll");
    expect(names).toContain("browser_evaluate");
    expect(tools.length).toBeGreaterThanOrEqual(6);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/__tests__/tools.test.ts`
Expected: FAIL

**Step 3: Implement browser tools**

Create `app/src/tools.ts`:

```typescript
import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { BrowserController, PageSnapshot } from "./browser.js";

function textResult(text: string): AgentToolResult<void> {
  return { content: [{ type: "text", text }], details: undefined };
}

function imageResult(screenshot: Buffer, text: string): AgentToolResult<void> {
  return {
    content: [
      { type: "image", mediaType: "image/png", data: screenshot.toString("base64") },
      { type: "text", text },
    ],
    details: undefined,
  };
}

export function createBrowserTools(browser: BrowserController): AgentTool<any>[] {
  const navigate: AgentTool<typeof NavigateParams> = {
    name: "browser_navigate",
    label: "Navigate",
    description: "Navigate the browser to a URL. Returns a screenshot and accessibility tree of the page.",
    parameters: Type.Object({
      url: Type.String({ description: "The URL to navigate to" }),
    }),
    execute: async (_id, params) => {
      if (!browser.isRunning()) await browser.launch();
      await browser.navigate(params.url);
      const snap = await browser.snapshot();
      return imageResult(snap.screenshot, `Navigated to ${snap.url} — "${snap.title}"\n\nAccessibility tree:\n${snap.accessibilityTree}`);
    },
  };
  const NavigateParams = navigate.parameters;

  const screenshot: AgentTool<typeof ScreenshotParams> = {
    name: "browser_screenshot",
    label: "Screenshot",
    description: "Take a screenshot of the current page and return the accessibility tree.",
    parameters: Type.Object({}),
    execute: async () => {
      const snap = await browser.snapshot();
      return imageResult(snap.screenshot, `Current page: ${snap.url} — "${snap.title}"\n\nAccessibility tree:\n${snap.accessibilityTree}`);
    },
  };
  const ScreenshotParams = screenshot.parameters;

  const click: AgentTool<typeof ClickParams> = {
    name: "browser_click",
    label: "Click",
    description: "Click on an element in the browser. Use CSS selector or text selector. Returns a screenshot after clicking.",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector or text= selector for the element to click" }),
    }),
    execute: async (_id, params) => {
      await browser.click(params.selector);
      const snap = await browser.snapshot();
      return imageResult(snap.screenshot, `Clicked "${params.selector}". Page is now: ${snap.url}\n\nAccessibility tree:\n${snap.accessibilityTree}`);
    },
  };
  const ClickParams = click.parameters;

  const typeText: AgentTool<typeof TypeParams> = {
    name: "browser_type",
    label: "Type",
    description: "Type text into an input field in the browser.",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector for the input element" }),
      text: Type.String({ description: "Text to type" }),
      submit: Type.Optional(Type.Boolean({ description: "Press Enter after typing (default: false)" })),
    }),
    execute: async (_id, params) => {
      await browser.type(params.selector, params.text);
      if (params.submit) await browser.press("Enter");
      const snap = await browser.snapshot();
      return imageResult(snap.screenshot, `Typed "${params.text}" into "${params.selector}". Page: ${snap.url}\n\nAccessibility tree:\n${snap.accessibilityTree}`);
    },
  };
  const TypeParams = typeText.parameters;

  const scroll: AgentTool<typeof ScrollParams> = {
    name: "browser_scroll",
    label: "Scroll",
    description: "Scroll the page up or down.",
    parameters: Type.Object({
      direction: Type.Union([Type.Literal("up"), Type.Literal("down")], { description: "Scroll direction" }),
      amount: Type.Optional(Type.Number({ description: "Pixels to scroll (default: 500)" })),
    }),
    execute: async (_id, params) => {
      await browser.scroll(params.direction, params.amount);
      const snap = await browser.snapshot();
      return imageResult(snap.screenshot, `Scrolled ${params.direction}. Page: ${snap.url}\n\nAccessibility tree:\n${snap.accessibilityTree}`);
    },
  };
  const ScrollParams = scroll.parameters;

  const evaluate: AgentTool<typeof EvalParams> = {
    name: "browser_evaluate",
    label: "Evaluate JS",
    description: "Execute JavaScript in the browser page and return the result.",
    parameters: Type.Object({
      code: Type.String({ description: "JavaScript code to evaluate in the page context" }),
    }),
    execute: async (_id, params) => {
      const result = await browser.evaluate(params.code);
      return textResult(`Result: ${JSON.stringify(result, null, 2)}`);
    },
  };
  const EvalParams = evaluate.parameters;

  const shell: AgentTool<typeof ShellParams> = {
    name: "shell",
    label: "Shell",
    description: "Execute a shell command and return stdout/stderr.",
    parameters: Type.Object({
      command: Type.String({ description: "Shell command to execute" }),
    }),
    execute: async (_id, params) => {
      const { execSync } = await import("node:child_process");
      try {
        const output = execSync(params.command, { encoding: "utf-8", timeout: 60000, maxBuffer: 1024 * 1024 });
        return textResult(output);
      } catch (e: any) {
        return textResult(`Error: ${e.stderr || e.message}`);
      }
    },
  };
  const ShellParams = shell.parameters;

  const fetchUrl: AgentTool<typeof FetchParams> = {
    name: "fetch",
    label: "Fetch",
    description: "Make an HTTP request and return the response body. Use for APIs or when browser isn't needed.",
    parameters: Type.Object({
      url: Type.String({ description: "URL to fetch" }),
      method: Type.Optional(Type.String({ description: "HTTP method (default: GET)" })),
      body: Type.Optional(Type.String({ description: "Request body (for POST/PUT)" })),
      headers: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "Request headers" })),
    }),
    execute: async (_id, params) => {
      const resp = await fetch(params.url, {
        method: params.method || "GET",
        body: params.body,
        headers: params.headers,
      });
      const text = await resp.text();
      return textResult(`Status: ${resp.status}\n\n${text.slice(0, 50000)}`);
    },
  };
  const FetchParams = fetchUrl.parameters;

  return [navigate, screenshot, click, typeText, scroll, evaluate, shell, fetchUrl];
}
```

**Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/__tests__/tools.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add app/src/tools.ts app/src/__tests__/tools.test.ts
git commit -m "feat: add browser and utility tools for agent"
```

---

### Task 5: Build the Skill Loader with NLP Matching

**Goal:** Load markdown skills from `skills/` directory, match user intent to skills using the LLM.

**Files:**
- Create: `app/src/skills.ts`

**Step 1: Write the failing test**

Create `app/src/__tests__/skills.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { loadSkills, type Skill } from "../skills.js";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("loadSkills", () => {
  it("should load a single markdown skill", () => {
    const dir = mkdtempSync(join(tmpdir(), "skills-"));
    writeFileSync(join(dir, "check-email.md"), `---
name: check-email
description: Check email for urgent messages
triggers: [email, gmail, inbox]
---

## Instructions
1. Open gmail.com
2. Check for unread
`);
    const skills = loadSkills(dir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("check-email");
    expect(skills[0].description).toBe("Check email for urgent messages");
    expect(skills[0].triggers).toEqual(["email", "gmail", "inbox"]);
  });

  it("should load a folder skill with skill.md", () => {
    const dir = mkdtempSync(join(tmpdir(), "skills-"));
    const skillDir = join(dir, "deploy-site");
    mkdirSync(skillDir);
    writeFileSync(join(skillDir, "skill.md"), `---
name: deploy-site
description: Deploy website
triggers: [deploy, release]
---

## Instructions
1. Run ./deploy.sh
`);
    writeFileSync(join(skillDir, "deploy.sh"), "#!/bin/bash\necho deployed");
    const skills = loadSkills(dir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("deploy-site");
    expect(skills[0].baseDir).toBe(skillDir);
  });

  it("should return empty array for missing directory", () => {
    const skills = loadSkills("/nonexistent/path");
    expect(skills).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/__tests__/skills.test.ts`
Expected: FAIL

**Step 3: Implement skill loader**

Create `app/src/skills.ts`:

```typescript
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";

export interface Skill {
  name: string;
  description: string;
  triggers: string[];
  instructions: string;
  baseDir: string;
}

interface SkillFrontmatter {
  name?: string;
  description?: string;
  triggers?: string[];
}

function parseFrontmatter(content: string): { meta: SkillFrontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const yamlBlock = match[1];
  const body = match[2].trim();
  const meta: SkillFrontmatter = {};

  for (const line of yamlBlock.split("\n")) {
    const kvMatch = line.match(/^(\w+):\s*(.+)$/);
    if (!kvMatch) continue;
    const [, key, value] = kvMatch;
    if (key === "name") meta.name = value.trim();
    if (key === "description") meta.description = value.trim();
    if (key === "triggers") {
      const arrayMatch = value.match(/\[([^\]]*)\]/);
      if (arrayMatch) {
        meta.triggers = arrayMatch[1].split(",").map((s) => s.trim());
      }
    }
  }

  return { meta, body };
}

function loadSkillFromFile(filePath: string, baseDir: string): Skill | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const { meta, body } = parseFrontmatter(content);
    if (!meta.name) return null;

    return {
      name: meta.name,
      description: meta.description || "",
      triggers: meta.triggers || [],
      instructions: body,
      baseDir,
    };
  } catch {
    return null;
  }
}

export function loadSkills(skillsDir: string): Skill[] {
  if (!existsSync(skillsDir)) return [];

  const skills: Skill[] = [];
  const entries = readdirSync(skillsDir);

  for (const entry of entries) {
    const fullPath = join(skillsDir, entry);
    const stat = statSync(fullPath);

    if (stat.isFile() && entry.endsWith(".md")) {
      // Single file skill
      const skill = loadSkillFromFile(fullPath, skillsDir);
      if (skill) skills.push(skill);
    } else if (stat.isDirectory()) {
      // Folder skill with skill.md
      const skillMd = join(fullPath, "skill.md");
      if (existsSync(skillMd)) {
        const skill = loadSkillFromFile(skillMd, fullPath);
        if (skill) skills.push(skill);
      }
    }
  }

  return skills;
}

export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";

  const lines = ["## Available Skills\n"];
  for (const skill of skills) {
    lines.push(`### ${skill.name}`);
    lines.push(`${skill.description}`);
    if (skill.baseDir) lines.push(`Scripts directory: ${skill.baseDir}`);
    lines.push("");
    lines.push(skill.instructions);
    lines.push("");
  }
  return lines.join("\n");
}

export function formatSkillsForMatching(skills: Skill[]): string {
  return skills
    .map((s) => `- name: "${s.name}", description: "${s.description}", triggers: [${s.triggers.join(", ")}]`)
    .join("\n");
}
```

**Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/__tests__/skills.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add app/src/skills.ts app/src/__tests__/skills.test.ts
git commit -m "feat: add skill loader with markdown parsing and NLP matching support"
```

---

### Task 6: Build the Agent Runner

**Goal:** Wire together the Agent (from pi-agent-core), tools, skills, and system prompt into a runner that processes user requests.

**Files:**
- Create: `app/src/runner.ts`

**Step 1: Implement the runner**

Create `app/src/runner.ts`:

```typescript
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel, stream } from "@mariozechner/pi-ai";
import { BrowserController } from "./browser.js";
import { createBrowserTools } from "./tools.js";
import { loadSkills, formatSkillsForPrompt } from "./skills.js";
import { join } from "node:path";

export interface RunOptions {
  visible?: boolean;
  model?: string;
  skillsDir?: string;
}

function buildSystemPrompt(skills: ReturnType<typeof loadSkills>): string {
  const skillsSection = formatSkillsForPrompt(skills);

  return `You are x-lens, a personal AI agent that helps users accomplish tasks.

You have access to a browser you can control, a shell for running commands, and an HTTP fetch tool.

When using the browser:
1. Navigate to the relevant page
2. Look at the screenshot and accessibility tree to understand what's on screen
3. Decide what action to take (click, type, scroll)
4. Take the action
5. Check the result via another screenshot
6. Repeat until the task is done

When the user asks you to do something:
- If a skill matches their request, follow the skill's instructions
- If no skill matches, use your general capabilities
- Prefer using the browser for web tasks
- Use shell for local commands and scripts
- Use fetch for simple API calls

Always report back what you did and the outcome.

${skillsSection}`;
}

export async function runOnce(prompt: string, options: RunOptions = {}): Promise<void> {
  const browser = new BrowserController({ headless: !options.visible });
  const tools = createBrowserTools(browser);
  const skillsDir = options.skillsDir || join(process.cwd(), "skills");
  const skills = loadSkills(skillsDir);

  const model = getModel("amazon-bedrock", options.model || "anthropic.claude-sonnet-4-20250514-v1:0");

  const agent = new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt(skills),
      model,
      thinkingLevel: "off",
      tools,
    },
  });

  agent.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
    if (event.type === "tool_execution_start") {
      console.log(`\n[tool] ${event.toolName}...`);
    }
    if (event.type === "agent_end") {
      console.log("\n");
    }
  });

  try {
    await agent.prompt(prompt);
    await agent.waitForIdle();
  } finally {
    await browser.close();
  }
}
```

**Step 2: Commit**

```bash
git add app/src/runner.ts
git commit -m "feat: add agent runner wiring tools, skills, and LLM"
```

---

### Task 7: Build the REPL Mode

**Goal:** Create an interactive REPL using pi-tui where the user can chat with the agent.

**Files:**
- Create: `app/src/repl.ts`

**Step 1: Implement the REPL**

Create `app/src/repl.ts`:

```typescript
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { TUI, ProcessTerminal, Editor, Text, Markdown } from "@mariozechner/pi-tui";
import { BrowserController } from "./browser.js";
import { createBrowserTools } from "./tools.js";
import { loadSkills, formatSkillsForPrompt } from "./skills.js";
import { join } from "node:path";

export interface ReplOptions {
  visible?: boolean;
  model?: string;
  skillsDir?: string;
}

function buildSystemPrompt(skills: ReturnType<typeof loadSkills>): string {
  const skillsSection = formatSkillsForPrompt(skills);

  return `You are x-lens, a personal AI agent that helps users accomplish tasks.

You have access to a browser you can control, a shell for running commands, and an HTTP fetch tool.

When using the browser:
1. Navigate to the relevant page
2. Look at the screenshot and accessibility tree to understand what's on screen
3. Decide what action to take (click, type, scroll)
4. Take the action
5. Check the result via another screenshot
6. Repeat until the task is done

When the user asks you to do something:
- If a skill matches their request, follow the skill's instructions
- If no skill matches, use your general capabilities
- Prefer using the browser for web tasks
- Use shell for local commands and scripts
- Use fetch for simple API calls

Always report back what you did and the outcome.

${skillsSection}`;
}

export async function runInteractive(options: ReplOptions = {}): Promise<void> {
  const browser = new BrowserController({ headless: !options.visible });
  const tools = createBrowserTools(browser);
  const skillsDir = options.skillsDir || join(process.cwd(), "skills");
  const skills = loadSkills(skillsDir);

  const model = getModel("amazon-bedrock", options.model || "anthropic.claude-sonnet-4-20250514-v1:0");

  const agent = new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt(skills),
      model,
      thinkingLevel: "off",
      tools,
    },
  });

  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

  const header = new Text("x-lens — personal agent (type 'exit' to quit)\n");
  tui.addChild(header);

  const outputArea = new Markdown("");
  tui.addChild(outputArea);

  const editor = new Editor(tui, {});
  tui.addChild(editor);

  let currentOutput = "";

  agent.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
      currentOutput += event.assistantMessageEvent.delta;
      outputArea.update(currentOutput);
    }
    if (event.type === "tool_execution_start") {
      currentOutput += `\n\n*[using ${event.toolName}...]*\n\n`;
      outputArea.update(currentOutput);
    }
    if (event.type === "agent_end") {
      currentOutput += "\n\n---\n\n";
      outputArea.update(currentOutput);
    }
  });

  editor.onSubmit = async (text: string) => {
    if (text.trim() === "exit") {
      await browser.close();
      tui.stop();
      process.exit(0);
    }

    currentOutput += `**You:** ${text}\n\n`;
    outputArea.update(currentOutput);

    try {
      await agent.prompt(text);
      await agent.waitForIdle();
    } catch (e: any) {
      currentOutput += `\n**Error:** ${e.message}\n\n`;
      outputArea.update(currentOutput);
    }
  };

  tui.start();
}
```

**Step 2: Commit**

```bash
git add app/src/repl.ts
git commit -m "feat: add interactive REPL mode using pi-tui"
```

---

### Task 8: Create Example Skills

**Goal:** Create a few example skills to demonstrate the system.

**Files:**
- Create: `skills/check-email.md`
- Create: `skills/search-web.md`
- Create: `skills/screenshot-page/skill.md`
- Create: `skills/screenshot-page/save.sh`

**Step 1: Create skills directory and example skills**

Create `skills/check-email.md`:
```markdown
---
name: check-email
description: Check email for new or urgent messages
triggers: [email, gmail, inbox, mail, urgent, unread]
---

## Instructions

1. Navigate to https://mail.google.com
2. Wait for the inbox to load
3. Look at the screenshot to identify unread messages
4. Summarize what you see: sender, subject, preview
5. Highlight anything that looks urgent
6. Report back to the user
```

Create `skills/search-web.md`:
```markdown
---
name: search-web
description: Search the web for information
triggers: [search, find, look up, google, what is, who is, how to]
---

## Instructions

1. Navigate to https://www.google.com
2. Type the user's query into the search box
3. Press Enter to search
4. Read the search results from the page
5. If needed, click on relevant results for more detail
6. Summarize the findings for the user
```

Create `skills/screenshot-page/skill.md`:
```markdown
---
name: screenshot-page
description: Take a screenshot of a webpage and save it
triggers: [screenshot, capture, save page, snapshot]
---

## Instructions

1. Navigate to the URL the user specified
2. Take a screenshot
3. Run the save script: `bash {baseDir}/save.sh <filename>`
4. Confirm the screenshot was saved
```

Create `skills/screenshot-page/save.sh`:
```bash
#!/bin/bash
# Save screenshot to ~/Downloads
FILENAME="${1:-screenshot-$(date +%Y%m%d-%H%M%S).png}"
mkdir -p ~/Downloads/x-lens-screenshots
cp /dev/stdin ~/Downloads/x-lens-screenshots/"$FILENAME"
echo "Saved to ~/Downloads/x-lens-screenshots/$FILENAME"
```

**Step 2: Commit**

```bash
chmod +x skills/screenshot-page/save.sh
git add skills/
git commit -m "feat: add example skills (check-email, search-web, screenshot-page)"
```

---

### Task 9: Wire Up CLI Entry Point and Test End-to-End

**Goal:** Make sure `x-lens "hello"` and `x-lens` (REPL) both work.

**Step 1: Verify main.ts imports resolve**

Ensure `app/src/main.ts` correctly imports runner and repl modules.

**Step 2: Build the full project**

Run:
```bash
npm run build
```
Expected: All packages build without errors.

**Step 3: Test command mode**

Run:
```bash
node app/dist/main.js "What is the current time?"
```
Expected: Agent responds using tools (likely shell `date` command).

**Step 4: Test REPL mode**

Run:
```bash
node app/dist/main.js
```
Expected: Interactive editor appears, user can type and get responses.

**Step 5: Test with browser**

Run:
```bash
node app/dist/main.js --visible "Go to example.com and tell me what you see"
```
Expected: Browser window opens, agent navigates and describes the page.

**Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: wire up CLI entry point and resolve build issues"
```

---

### Task 10: Add Status Page

**Goal:** Simple local web page showing agent activity, browser screenshots, and logs.

**Files:**
- Create: `app/src/status-server.ts`

**Step 1: Implement a minimal status server**

Create `app/src/status-server.ts`:

```typescript
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface StatusUpdate {
  type: "tool" | "message" | "screenshot" | "error";
  timestamp: number;
  content: string;
  screenshot?: string; // base64 PNG
}

export class StatusServer {
  private updates: StatusUpdate[] = [];
  private server: ReturnType<typeof createServer> | null = null;

  addUpdate(update: StatusUpdate): void {
    this.updates.push(update);
    if (this.updates.length > 200) this.updates.shift();
  }

  async start(port: number = 3456): Promise<void> {
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === "/api/updates") {
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify(this.updates.slice(-50)));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(STATUS_HTML);
    });

    this.server.listen(port, () => {
      console.log(`Status page: http://localhost:${port}`);
    });
  }

  async stop(): Promise<void> {
    this.server?.close();
  }
}

const STATUS_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>x-lens status</title>
  <style>
    body { font-family: monospace; background: #1a1a2e; color: #e0e0e0; margin: 2rem; }
    h1 { color: #00d4ff; }
    .update { border-left: 3px solid #333; padding: 0.5rem 1rem; margin: 0.5rem 0; }
    .update.tool { border-color: #ffd700; }
    .update.message { border-color: #00d4ff; }
    .update.error { border-color: #ff4444; }
    .update.screenshot { border-color: #44ff44; }
    img { max-width: 600px; border: 1px solid #333; margin-top: 0.5rem; }
    .time { color: #666; font-size: 0.8em; }
  </style>
</head>
<body>
  <h1>x-lens status</h1>
  <div id="updates"></div>
  <script>
    async function poll() {
      try {
        const res = await fetch("/api/updates");
        const updates = await res.json();
        const el = document.getElementById("updates");
        el.innerHTML = updates.reverse().map(u => {
          let html = '<div class="update ' + u.type + '">';
          html += '<span class="time">' + new Date(u.timestamp).toLocaleTimeString() + '</span> ';
          html += '<strong>[' + u.type + ']</strong> ' + u.content;
          if (u.screenshot) html += '<br><img src="data:image/png;base64,' + u.screenshot + '">';
          html += '</div>';
          return html;
        }).join("");
      } catch {}
      setTimeout(poll, 2000);
    }
    poll();
  </script>
</body>
</html>`;
```

**Step 2: Wire status server into runner**

Update `app/src/runner.ts` to optionally start the status server and push updates to it from agent events.

**Step 3: Commit**

```bash
git add app/src/status-server.ts
git commit -m "feat: add status page for live agent monitoring"
```

---

### Task 11: Final Integration and Cleanup

**Goal:** Make sure everything works together, clean up, add a .gitignore.

**Step 1: Create .gitignore**

```
node_modules/
dist/
.x-lens/
*.tgz
```

**Step 2: Verify full build**

Run:
```bash
npm install
npm run build
```

**Step 3: Test all modes**

```bash
# Command mode
node app/dist/main.js "tell me a joke"

# REPL mode
node app/dist/main.js

# With visible browser
node app/dist/main.js --visible "go to example.com"
```

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: final integration, cleanup, and .gitignore"
```
