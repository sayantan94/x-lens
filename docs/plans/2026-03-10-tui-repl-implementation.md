# TUI Chat Interface Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the readline-based REPL with a `@mariozechner/pi-tui` chat interface that renders markdown, inline screenshots, tool call status, and a multi-line editor.

**Architecture:** Rewrite `repl.ts` to use TUI components instead of `console.log` + `readline`. The agent logic (creation, event subscription, session persistence, compaction) stays identical. A new `themes.ts` file defines x-lens-specific themes for markdown, editor, and tool call rendering.

**Tech Stack:** TypeScript, `@mariozechner/pi-tui` (already in monorepo and `package.json`)

---

### Task 1: Create x-lens TUI themes

**Files:**
- Create: `app/src/themes.ts`

**Step 1: Create the theme file**

Create `app/src/themes.ts` with themes for all TUI components:

```typescript
import chalk from "chalk";
import type { EditorTheme, MarkdownTheme, SelectListTheme, ImageTheme } from "@mariozechner/pi-tui";

export const selectListTheme: SelectListTheme = {
	selectedPrefix: (text: string) => chalk.cyan(text),
	selectedText: (text: string) => chalk.bold(text),
	description: (text: string) => chalk.dim(text),
	scrollInfo: (text: string) => chalk.dim(text),
	noMatch: (text: string) => chalk.dim(text),
};

export const markdownTheme: MarkdownTheme = {
	heading: (text: string) => chalk.bold.cyan(text),
	link: (text: string) => chalk.blue(text),
	linkUrl: (text: string) => chalk.dim(text),
	code: (text: string) => chalk.yellow(text),
	codeBlock: (text: string) => chalk.green(text),
	codeBlockBorder: (text: string) => chalk.dim(text),
	quote: (text: string) => chalk.italic(text),
	quoteBorder: (text: string) => chalk.dim(text),
	hr: (text: string) => chalk.dim(text),
	listBullet: (text: string) => chalk.cyan(text),
	bold: (text: string) => chalk.bold(text),
	italic: (text: string) => chalk.italic(text),
	strikethrough: (text: string) => chalk.strikethrough(text),
	underline: (text: string) => chalk.underline(text),
};

export const userMarkdownTheme: MarkdownTheme = {
	...markdownTheme,
};

export const editorTheme: EditorTheme = {
	borderColor: (text: string) => chalk.dim(text),
	selectList: selectListTheme,
};

export const imageTheme: ImageTheme = {
	fallbackColor: (text: string) => chalk.dim(text),
};

// Tool call styling
export const toolStyle = {
	icon: {
		start: (text: string) => chalk.yellow(text),
		success: (text: string) => chalk.green(text),
		error: (text: string) => chalk.red(text),
	},
	label: (text: string) => chalk.yellow(text),
	args: (text: string) => chalk.dim(text),
	duration: (text: string) => chalk.dim(text),
	result: (text: string) => chalk.dim(text),
};

// Header styling
export const headerStyle = {
	brand: (text: string) => chalk.bold.cyan(text),
	separator: (text: string) => chalk.dim(text),
	info: (text: string) => chalk.dim(text),
	tokens: (text: string) => chalk.dim(text),
};
```

**Step 2: Verify it compiles**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && npx tsc --noEmit src/themes.ts`

Expected: No errors

**Step 3: Commit**

```bash
git add app/src/themes.ts
git commit -m "feat: add TUI themes for x-lens chat interface"
```

---

### Task 2: Rewrite repl.ts with TUI

**Files:**
- Modify: `app/src/repl.ts` (complete rewrite)

**Context:** This is the main task. The current `repl.ts` uses `readline` for input and `console.log` for output. We replace it with `@mariozechner/pi-tui` components. The agent logic is preserved exactly — only the rendering layer changes.

**Reference:** `tui/test/chat-simple.ts` shows the pattern: create `TUI`, add components, use `Editor` for input, insert `Markdown`/`Text`/`Loader` components into the children array.

**Step 1: Write the new repl.ts**

Replace the entire contents of `app/src/repl.ts` with:

```typescript
import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import { getModel, type AssistantMessage, type Message } from "@mariozechner/pi-ai";
import chalk from "chalk";
import {
	TUI,
	ProcessTerminal,
	Text,
	TruncatedText,
	Markdown,
	Loader,
	Image,
	Spacer,
	Editor,
	CombinedAutocompleteProvider,
} from "@mariozechner/pi-tui";
import { BrowserController } from "./browser.js";
import { createTools } from "./tools.js";
import { loadSkills, formatSkillsForPrompt } from "./skills.js";
import { StatusServer } from "./status-server.js";
import { formatToolLabel, extractResultPreview } from "./render.js";
import {
	readMemory,
	loadSessionMessages,
	appendSessionMessage,
	saveSessionMessages,
	clearSession,
} from "./memory.js";
import { shouldCompact, isContextOverflow, compact } from "./compaction.js";
import { JobStore } from "./job-store.js";
import {
	markdownTheme,
	userMarkdownTheme,
	editorTheme,
	imageTheme,
	toolStyle,
	headerStyle,
} from "./themes.js";

export interface ReplOptions {
	visible?: boolean;
	model?: string;
	provider?: string;
	persona?: string;
	new?: boolean;
}

function resolveModel(options: ReplOptions) {
	const provider = options.provider || "bedrock";
	const modelId = options.model || process.env.X_LENS_MODEL;
	if (provider === "anthropic") {
		return getModel("anthropic", (modelId || "claude-sonnet-4-20250514") as any);
	}
	if (provider === "openrouter") {
		return getModel("openrouter", (modelId || "qwen/qwen3-235b-a22b") as any);
	}
	if (provider === "groq") {
		return getModel("groq", (modelId || "qwen/qwen3-32b") as any);
	}
	return getModel("amazon-bedrock", (modelId || "anthropic.claude-sonnet-4-20250514-v1:0") as any);
}

function convertToLlm(messages: Message[]): Message[] {
	return messages.filter(
		(m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult",
	);
}

function buildSystemPrompt(skills: ReturnType<typeof loadSkills>, memory: string): string {
	const skillsSection = formatSkillsForPrompt(skills);

	return `You are x-lens, a personal AI agent that helps users accomplish tasks.

You have access to a browser you can control, a shell for running commands, and an HTTP fetch tool.
You have access to previous conversation context including tool results from prior turns.

When using the browser:
1. Navigate to the relevant page
2. Look at the screenshot and accessibility tree to understand what's on screen
3. Decide what action to take (click, type, scroll)
4. Take the action
5. Check the result via another screenshot
6. Repeat until the task is done

IMPORTANT — Skill Usage Protocol:
1. BEFORE doing anything, scan the Available Skills list below for a match to the user's request
2. If ANY skill matches (even partially), you MUST call the skill_read tool to load its full instructions FIRST
3. Then follow the skill's instructions exactly — do not freestyle when a skill exists
4. Only use general capabilities if NO skill matches the request
5. When using a skill, announce it: "Using skill: <name>"

Tools:
- Browser for web tasks (navigate, click, type, scroll, screenshot)
- Shell for local commands and scripts
- Fetch for API calls (prefer this over browser for JSON APIs)
- Web search for Google queries

Always report back what you did and the outcome.

## Your Memory
${memory}

You can save important information using the memory_write or memory_append tools.
Save things like: user preferences, frequently used URLs, login info hints, recurring tasks.

${skillsSection}`;
}

function formatTokens(tokens: number): string {
	if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K`;
	return String(tokens);
}

export async function runInteractive(options: ReplOptions = {}): Promise<void> {
	const browser = new BrowserController({ headless: !options.visible });
	const projectRoot = new URL("../..", import.meta.url).pathname;
	const skills = loadSkills(projectRoot, options.persona);
	const jobStore = new JobStore();
	const tools = createTools(browser, skills, jobStore, options.persona);
	const status = new StatusServer();

	const model = resolveModel(options);
	const memory = readMemory();

	// Handle session
	if (options.new) {
		clearSession();
	}

	const agent = new Agent({
		initialState: {
			systemPrompt: buildSystemPrompt(skills, memory),
			model,
			thinkingLevel: "off",
			tools,
		},
		convertToLlm,
		steeringMode: "one-at-a-time",
		followUpMode: "one-at-a-time",
	});

	// Restore previous session
	const previousMessages = loadSessionMessages();
	if (previousMessages.length > 0) {
		agent.replaceMessages(previousMessages);
	}

	// --- TUI Setup ---
	const terminal = new ProcessTerminal();
	const tui = new TUI(terminal);

	// Header
	const persona = options.persona || "default";
	const provider = options.provider || "bedrock";
	const headerText = `${headerStyle.brand("x-lens")} ${headerStyle.separator("·")} ${headerStyle.info(persona)} ${headerStyle.separator("·")} ${headerStyle.info(provider)}`;
	const header = new TruncatedText(headerText, 1, 0);
	tui.addChild(header);
	tui.addChild(new Spacer(1));

	// Session resume notice
	if (previousMessages.length > 0) {
		tui.addChild(new Text(chalk.dim(`Resuming session (${previousMessages.length} messages). Use /new to start fresh.`), 1, 0));
		tui.addChild(new Spacer(1));
	}

	// Editor with autocomplete
	const editor = new Editor(tui, editorTheme);
	const autocompleteProvider = new CombinedAutocompleteProvider(
		[
			{ name: "exit", description: "Quit x-lens" },
			{ name: "new", description: "Start a new session" },
			{ name: "clear", description: "Clear chat display" },
			{ name: "jobs", description: "Show scheduled jobs" },
		],
		process.cwd(),
	);
	editor.setAutocompleteProvider(autocompleteProvider);
	tui.addChild(editor);
	tui.setFocus(editor);

	// --- Agent state ---
	let agentBusy = false;
	let responseText = "";
	let hasError = false;
	let aborted = false;
	let needsRetryAfterCompaction = false;
	let lastInputTokens = 0;
	let lastOutputTokens = 0;
	let lastCacheReadTokens = 0;
	let lastCacheWriteTokens = 0;
	let turnStartTime = 0;
	let currentResponseMarkdown: Markdown | null = null;
	let currentLoader: Loader | null = null;

	const browserToolNames = new Set([
		"browser_navigate", "browser_screenshot", "browser_click",
		"browser_type", "browser_scroll",
	]);

	const toolStartTimes = new Map<string, { startTime: number; args: Record<string, unknown> }>();

	// Helper: insert component before editor
	function insertBeforeEditor(component: any): void {
		const children = tui.children;
		children.splice(children.length - 1, 0, component);
		tui.requestRender();
	}

	// Helper: remove component
	function removeComponent(component: any): void {
		tui.removeChild(component);
		tui.requestRender();
	}

	// Helper: update header with token info
	function updateHeader(): void {
		const tokenInfo = lastInputTokens > 0 ? ` ${headerStyle.separator("·")} ${headerStyle.tokens(`${formatTokens(lastInputTokens)} tokens`)}` : "";
		const text = `${headerStyle.brand("x-lens")} ${headerStyle.separator("·")} ${headerStyle.info(persona)} ${headerStyle.separator("·")} ${headerStyle.info(provider)}${tokenInfo}`;
		header.setText(text);
		tui.requestRender();
	}

	// Helper: show loader
	function showLoader(message: string): void {
		if (currentLoader) removeComponent(currentLoader);
		currentLoader = new Loader(
			tui,
			(s) => chalk.cyan(s),
			(s) => chalk.dim(s),
			message,
		);
		insertBeforeEditor(currentLoader);
	}

	// Helper: hide loader
	function hideLoader(): void {
		if (currentLoader) {
			removeComponent(currentLoader);
			currentLoader = null;
		}
	}

	// Compaction helper
	const logCompaction = (msg: string) => {
		insertBeforeEditor(new Text(chalk.magenta(`⟳ ${msg}`), 1, 0));
	};

	async function checkAndCompact(): Promise<void> {
		if (!shouldCompact(lastInputTokens + lastCacheReadTokens, model.contextWindow)) return;

		logCompaction(`Context at ${lastInputTokens} tokens (limit: ${model.contextWindow}). Compacting...`);
		status.addUpdate({
			type: "tool_start",
			timestamp: Date.now(),
			content: "",
			toolName: "compaction",
			toolLabel: "Compacting conversation context...",
			source: "repl",
		});

		try {
			const result = await compact(agent, model, logCompaction);
			if (result) {
				saveSessionMessages(agent.state.messages as Message[]);
				logCompaction(`Done. ${result.messagesRemoved} messages summarized, ${result.messagesKept} kept.`);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			insertBeforeEditor(new Text(chalk.red(`Compaction failed: ${msg}`), 1, 0));
		}
	}

	// --- Agent event subscription ---
	agent.subscribe((event: AgentEvent) => {
		// Streaming text
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			const delta = event.assistantMessageEvent.delta;
			responseText += delta;

			if (!currentResponseMarkdown) {
				hideLoader();
				currentResponseMarkdown = new Markdown(responseText, 1, 1, markdownTheme);
				insertBeforeEditor(currentResponseMarkdown);
			} else {
				currentResponseMarkdown.setText(responseText);
				tui.requestRender();
			}
		}

		// Tool execution start
		if (event.type === "tool_execution_start") {
			const args = (event.args ?? {}) as Record<string, unknown>;
			toolStartTimes.set(event.toolCallId, { startTime: Date.now(), args });

			const label = formatToolLabel(event.toolName, args);
			showLoader(label);

			const toolText = new Text(
				`${toolStyle.icon.start("↳")} ${toolStyle.label(label)}`,
				1, 0,
			);
			insertBeforeEditor(toolText);

			status.addUpdate({
				type: "tool_start",
				timestamp: Date.now(),
				content: "",
				toolName: event.toolName,
				toolLabel: label,
				source: "repl",
			});
		}

		// Tool execution end
		if (event.type === "tool_execution_end") {
			const started = toolStartTimes.get(event.toolCallId);
			const durationMs = started ? Date.now() - started.startTime : 0;
			const args = started?.args ?? {};
			toolStartTimes.delete(event.toolCallId);

			const isErr = !!(event as any).isError;
			const label = formatToolLabel(event.toolName, args);
			const duration = (durationMs / 1000).toFixed(1);
			const icon = isErr ? toolStyle.icon.error("✗") : toolStyle.icon.success("✓");
			const resultPreview = extractResultPreview(event.result, isErr);

			const resultText = new Text(
				`${icon} ${toolStyle.label(label)} ${toolStyle.duration(`(${duration}s)`)}${resultPreview ? ` ${toolStyle.result(resultPreview.slice(0, 80))}` : ""}`,
				1, 0,
			);
			insertBeforeEditor(resultText);

			hideLoader();

			status.addUpdate({
				type: "tool_end",
				timestamp: Date.now(),
				content: resultPreview,
				toolName: event.toolName,
				toolLabel: label,
				duration: durationMs,
				isError: isErr,
				source: "repl",
			});

			// Inline browser screenshots
			if (browserToolNames.has(event.toolName)) {
				const content = (event.result as any)?.content;
				if (Array.isArray(content)) {
					const img = content.find((c: any) => c.type === "image");
					if (img) {
						const imageComponent = new Image(img.data, "image/png", imageTheme, {
							maxWidthCells: 80,
							maxHeightCells: 24,
						});
						insertBeforeEditor(imageComponent);

						status.addUpdate({
							type: "screenshot",
							timestamp: Date.now(),
							content: `Screenshot from ${event.toolName}`,
							screenshot: img.data,
							source: "repl",
						});
					}
				}
			}
		}

		// Track token usage
		if (event.type === "message_end") {
			appendSessionMessage(event.message as Message);

			const msg = event.message as any;
			if (msg.role === "assistant" && msg.usage) {
				lastInputTokens = msg.usage.input || 0;
				lastOutputTokens = msg.usage.output || 0;
				lastCacheReadTokens = msg.usage.cacheRead || 0;
				lastCacheWriteTokens = msg.usage.cacheWrite || 0;

				if (isContextOverflow(msg as AssistantMessage)) {
					logCompaction("Context overflow detected! Will compact after current run ends...");
					needsRetryAfterCompaction = true;
				}
			}
		}

		// Agent finished
		if (event.type === "agent_end") {
			// Emergency compaction + retry
			if (needsRetryAfterCompaction) {
				needsRetryAfterCompaction = false;
				responseText = "";
				currentResponseMarkdown = null;
				hasError = false;

				const messages = [...agent.state.messages] as Message[];
				if (messages.length > 0) {
					const last = messages[messages.length - 1] as any;
					if (last.role === "assistant" && last.stopReason === "error") {
						messages.pop();
						agent.replaceMessages(messages);
					}
				}

				setTimeout(() => {
					compact(agent, model, logCompaction).then((result) => {
						if (result) {
							saveSessionMessages(agent.state.messages as Message[]);
							logCompaction("Retrying after compaction...");
							setTimeout(() => agent.continue(), 0);
						} else {
							insertBeforeEditor(new Text(chalk.red("Compaction produced no result. Cannot retry."), 1, 0));
							agentBusy = false;
							editor.disableSubmit = false;
						}
					}).catch((err) => {
						insertBeforeEditor(new Text(chalk.red(`Emergency compaction failed: ${err instanceof Error ? err.message : String(err)}`), 1, 0));
						agentBusy = false;
						editor.disableSubmit = false;
					});
				}, 0);
				return;
			}

			// Check for errors
			if (!aborted && event.messages?.length) {
				for (const msg of event.messages) {
					const errorMsg = (msg as any).errorMessage;
					if (errorMsg) {
						insertBeforeEditor(new Text(chalk.red(`✗ ${errorMsg}`), 1, 0));
						hasError = true;
						status.addUpdate({
							type: "error",
							timestamp: Date.now(),
							content: errorMsg,
						});
					}
				}
			}

			hideLoader();

			if (aborted && currentResponseMarkdown) {
				insertBeforeEditor(new Text(chalk.yellow("⚠ Response interrupted"), 1, 0));
			}

			// Turn end stats
			const elapsed = turnStartTime > 0 ? Date.now() - turnStartTime : 0;
			if (elapsed > 0) {
				const elapsedSec = (elapsed / 1000).toFixed(1);
				insertBeforeEditor(new Text(
					chalk.dim(`${elapsedSec}s · ${formatTokens(lastInputTokens)} input tokens`),
					1, 0,
				));
			}
			insertBeforeEditor(new Spacer(1));

			// Check for [ALERT] markers
			if (responseText) {
				const alertMatch = responseText.match(/\[ALERT\]\s*(.+?)(?:\n|$)/i);
				if (alertMatch) {
					status.addUpdate({
						type: "alert",
						timestamp: Date.now(),
						content: alertMatch[1].trim(),
						source: "repl",
					});
				}
			}

			updateHeader();

			status.addUpdate({
				type: "turn_end",
				timestamp: Date.now(),
				content: "",
				tokens: lastInputTokens,
				inputTokens: lastInputTokens,
				outputTokens: lastOutputTokens,
				cacheReadTokens: lastCacheReadTokens,
				cacheWriteTokens: lastCacheWriteTokens,
				contextWindow: model.contextWindow,
				turnDuration: elapsed,
				source: "repl",
			});

			responseText = "";
			currentResponseMarkdown = null;
			hasError = false;
			aborted = false;

			checkAndCompact().finally(() => {
				agentBusy = false;
				editor.disableSubmit = false;
			});
		}
	});

	await status.start();

	// --- Handle editor submissions ---
	editor.onSubmit = async (value: string) => {
		const trimmed = value.trim();
		if (!trimmed) return;

		// Slash commands
		if (trimmed === "/exit") {
			tui.stop();
			try {
				await status.stop();
				await browser.close();
			} catch { /* ignore */ }
			process.exit(0);
		}

		if (trimmed === "/new") {
			clearSession();
			agent.replaceMessages([]);
			// Clear all children except header, spacer, and editor
			const children = tui.children;
			while (children.length > 3) {
				children.splice(2, 1);
			}
			insertBeforeEditor(new Text(chalk.dim("Session cleared."), 1, 0));
			insertBeforeEditor(new Spacer(1));
			return;
		}

		if (trimmed === "/clear") {
			const children = tui.children;
			while (children.length > 3) {
				children.splice(2, 1);
			}
			tui.requestRender();
			return;
		}

		if (trimmed === "/jobs") {
			const jobs = jobStore.list().filter(j => j.persona === (options.persona || ""));
			if (jobs.length === 0) {
				insertBeforeEditor(new Text(chalk.dim("No scheduled jobs."), 1, 0));
			} else {
				const jobList = jobs.map(j => {
					const enabledIcon = j.enabled ? chalk.green("●") : chalk.red("●");
					const lastRun = j.last_run ? new Date(j.last_run).toLocaleString() : "never";
					return `${enabledIcon} ${chalk.bold(j.id)} (${j.type}: ${j.schedule || `${j.interval_minutes}m`}) — last: ${lastRun}, runs: ${j.run_count}`;
				}).join("\n");
				insertBeforeEditor(new Text(jobList, 1, 1));
			}
			insertBeforeEditor(new Spacer(1));
			return;
		}

		// User message
		const userMessage: Message = {
			role: "user",
			content: [{ type: "text", text: trimmed }],
			timestamp: Date.now(),
		};

		if (agentBusy) {
			insertBeforeEditor(new Text(chalk.yellow("Steering agent with new instruction..."), 1, 0));
			agent.steer(userMessage);
			return;
		}

		// Show user message
		const userMd = new Markdown(trimmed, 1, 1, userMarkdownTheme, {
			bgColor: (text: string) => chalk.bgGray(text),
		});
		insertBeforeEditor(userMd);

		agentBusy = true;
		editor.disableSubmit = true;
		turnStartTime = Date.now();

		showLoader("Thinking...");

		status.addUpdate({
			type: "turn_start",
			timestamp: Date.now(),
			content: trimmed.length > 100 ? trimmed.slice(0, 100) + "..." : trimmed,
			source: "repl",
		});

		try {
			await agent.prompt(userMessage);
			await agent.waitForIdle();
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			insertBeforeEditor(new Text(chalk.red(`✗ ${message}`), 1, 0));
			hideLoader();
			status.addUpdate({
				type: "error",
				timestamp: Date.now(),
				content: message,
			});
			agentBusy = false;
			editor.disableSubmit = false;
		}
	};

	// Handle Ctrl+C
	process.on("SIGINT", () => {
		if (agentBusy) {
			insertBeforeEditor(new Text(chalk.yellow("Interrupting..."), 1, 0));
			aborted = true;
			agent.abort();
			return;
		}
		tui.stop();
		status.stop().catch(() => {});
		browser.close().catch(() => {});
		process.exit(0);
	});

	// Start TUI
	tui.start();
}
```

**Step 2: Verify it compiles**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && npm run build`

Expected: Clean build

**Step 3: Test manually**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens && node app/dist/main.js`

Expected: TUI renders with header, empty chat area, and editor at bottom. Type `/exit` to quit.

**Step 4: Commit**

```bash
git add app/src/repl.ts
git commit -m "feat: replace readline REPL with TUI chat interface"
```

---

### Task 3: Clean up render.ts imports

**Files:**
- Modify: `app/src/repl.ts` (imports only)
- Check: `app/src/runner.ts` (still uses render.ts)

**Step 1: Verify runner.ts still needs render.ts**

Read `app/src/runner.ts` and confirm it imports from `./render.js`. It should — runner.ts is the non-interactive one-shot mode that still uses `console.log`.

**Step 2: Verify repl.ts only imports what it needs from render.ts**

The new `repl.ts` imports `formatToolLabel` and `extractResultPreview` from `./render.js`. These are pure formatting functions that don't do any console output. Confirm these are the only imports needed.

**Step 3: If render.ts exports are clean, no changes needed**

`render.ts` stays as-is since `runner.ts` still uses it fully and `repl.ts` uses two utility functions from it.

**Step 4: Commit (only if changes were needed)**

---

### Task 4: Smoke test the full flow

**Step 1: Build**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && npm run build`

Expected: Clean build

**Step 2: Test TUI launches**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens && node app/dist/main.js`

Expected:
- Header shows "x-lens · default · bedrock"
- Editor renders at bottom with horizontal border lines
- Can type text, use arrow keys, multi-line with Alt+Enter
- `/exit` quits cleanly

**Step 3: Test with persona**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens && node app/dist/main.js --persona trader`

Expected:
- Header shows "x-lens · trader · bedrock"
- Session resume message if previous session exists
- `/new` clears session
- `/clear` clears display

**Step 4: Test agent interaction**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens && node app/dist/main.js --provider anthropic`

Type: `what is 2+2`

Expected:
- User message appears with background
- Loader shows "Thinking..."
- Assistant response renders as markdown
- Token count appears in header
- Turn duration shows at bottom

**Step 5: Test abort**

While agent is responding, press `Ctrl+C`.

Expected:
- "Interrupting..." message appears
- "⚠ Response interrupted" shows
- Editor re-enables for next input

**Step 6: Final commit if any fixes were needed**

```bash
git add app/src/repl.ts app/src/themes.ts
git commit -m "fix: TUI smoke test fixes"
```
