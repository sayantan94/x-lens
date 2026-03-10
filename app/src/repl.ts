import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import { getModel, type AssistantMessage, type Message } from "@mariozechner/pi-ai";
import {
	TUI,
	ProcessTerminal,
	Editor,
	Markdown,
	Text,
	TruncatedText,
	Loader,
	Image,
	Spacer,
	CombinedAutocompleteProvider,
	matchesKey,
	Key,
	type Component,
} from "@mariozechner/pi-tui";
import chalk from "chalk";
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
	headerStyle,
	toolStyle,
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

/**
 * Convert AgentMessages to LLM-compatible messages.
 * Mirrors mom's convertToLlm — keeps user/assistant/toolResult, strips custom types.
 */
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

// ---------------------------------------------------------------------------
// Helper: build the header text string
// ---------------------------------------------------------------------------
function buildHeaderText(
	persona: string | undefined,
	provider: string,
	modelId: string,
	inputTokens: number,
	contextWindow: number,
): string {
	const parts: string[] = [headerStyle.brand("x-lens")];
	if (persona) parts.push(headerStyle.info(persona));
	parts.push(headerStyle.info(`${provider}/${modelId}`));
	if (inputTokens > 0) {
		const pct = ((inputTokens / contextWindow) * 100).toFixed(0);
		parts.push(headerStyle.tokens(`${(inputTokens / 1000).toFixed(0)}K/${(contextWindow / 1000).toFixed(0)}K (${pct}%)`));
	}
	return parts.join(headerStyle.separator(" | "));
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

	// -----------------------------------------------------------------------
	// TUI setup
	// -----------------------------------------------------------------------
	const terminal = new ProcessTerminal();
	const tui = new TUI(terminal);

	// Header
	const providerName = options.provider || "bedrock";
	const modelName = options.model || process.env.X_LENS_MODEL || (providerName === "anthropic" ? "claude-sonnet-4-20250514" : "anthropic.claude-sonnet-4-20250514-v1:0");
	let header = new TruncatedText(
		buildHeaderText(options.persona, providerName, modelName, 0, model.contextWindow),
		1,
		0,
	);
	tui.addChild(header);
	tui.addChild(new Spacer(1));

	// Session resume notice
	if (previousMessages.length > 0) {
		tui.addChild(
			new Text(chalk.dim(`Resuming session (${previousMessages.length} messages). Use --new to start fresh.`), 1, 0),
		);
		tui.addChild(new Spacer(1));
	}

	// Editor with autocomplete
	const editor = new Editor(tui, editorTheme);
	const autocompleteProvider = new CombinedAutocompleteProvider(
		[
			{ name: "exit", description: "Quit x-lens" },
			{ name: "new", description: "Start a new session" },
			{ name: "clear", description: "Clear the display" },
			{ name: "jobs", description: "Show background jobs" },
		],
		process.cwd(),
	);
	editor.setAutocompleteProvider(autocompleteProvider);
	tui.addChild(editor);
	tui.setFocus(editor);

	// -----------------------------------------------------------------------
	// Agent state tracking
	// -----------------------------------------------------------------------
	let agentBusy = false;
	let responseText = "";
	let isStreaming = false;
	let hasError = false;
	let aborted = false;
	let needsRetryAfterCompaction = false;
	let lastInputTokens = 0;
	let lastOutputTokens = 0;
	let lastCacheReadTokens = 0;
	let lastCacheWriteTokens = 0;
	let turnStartTime = 0;

	const browserToolNames = new Set([
		"browser_navigate", "browser_screenshot", "browser_click",
		"browser_type", "browser_scroll",
	]);

	const toolStartTimes = new Map<string, { startTime: number; args: Record<string, unknown> }>();

	// Currently active Markdown component for streaming response
	let activeResponseMd: Markdown | null = null;
	// Currently active Loader component
	let activeLoader: Loader | null = null;

	// Helper: insert a component just before the editor (last child)
	function insertBeforeEditor(component: Component) {
		const children = tui.children;
		children.splice(children.length - 1, 0, component);
		tui.requestRender();
	}

	// Helper: remove the active loader
	function removeLoader() {
		if (activeLoader) {
			activeLoader.stop();
			tui.removeChild(activeLoader);
			activeLoader = null;
		}
	}

	// Helper: show a loader
	function showLoader(message: string) {
		removeLoader();
		activeLoader = new Loader(
			tui,
			(s) => chalk.cyan(s),
			(s) => chalk.dim(s),
			message,
		);
		insertBeforeEditor(activeLoader);
	}

	// Helper: update the header with current token counts
	function updateHeader() {
		const newHeader = new TruncatedText(
			buildHeaderText(options.persona, providerName, modelName, lastInputTokens, model.contextWindow),
			1,
			0,
		);
		const idx = tui.children.indexOf(header);
		if (idx !== -1) {
			tui.children[idx] = newHeader;
		}
		header = newHeader;
		tui.requestRender();
	}

	// Compaction helper
	function showCompactionMessage(msg: string) {
		const comp = new Text(chalk.magenta(`  \u27F3 ${msg}`), 0, 0);
		insertBeforeEditor(comp);
	}

	async function checkAndCompact(): Promise<void> {
		if (!shouldCompact(lastInputTokens + lastCacheReadTokens, model.contextWindow)) return;

		showCompactionMessage(`Context at ${lastInputTokens} tokens (limit: ${model.contextWindow}). Compacting...`);
		status.addUpdate({
			type: "tool_start",
			timestamp: Date.now(),
			content: "",
			toolName: "compaction",
			toolLabel: "Compacting conversation context...",
			source: "repl",
		});

		try {
			const result = await compact(agent, model, (msg: string) => showCompactionMessage(msg));
			if (result) {
				saveSessionMessages(agent.state.messages as Message[]);
				showCompactionMessage(`Done. ${result.messagesRemoved} messages summarized, ${result.messagesKept} kept.`);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			const errComp = new Text(chalk.red(`  Compaction failed: ${msg}`), 0, 0);
			insertBeforeEditor(errComp);
		}
	}

	// -----------------------------------------------------------------------
	// Subscribe to agent events
	// -----------------------------------------------------------------------
	agent.subscribe((event: AgentEvent) => {
		// Streaming text delta -> create/update Markdown
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			const delta = event.assistantMessageEvent.delta;
			responseText += delta;

			if (!isStreaming) {
				isStreaming = true;
				// Remove the loader while streaming text
				removeLoader();
				// Create a new Markdown component for the response
				activeResponseMd = new Markdown(responseText, 1, 1, markdownTheme);
				insertBeforeEditor(activeResponseMd);
			} else if (activeResponseMd) {
				activeResponseMd.setText(responseText);
				tui.requestRender();
			}
		}

		// Tool execution start
		if (event.type === "tool_execution_start") {
			const args = (event.args ?? {}) as Record<string, unknown>;
			toolStartTimes.set(event.toolCallId, { startTime: Date.now(), args });

			// If we were streaming text, finalize the markdown
			if (isStreaming) {
				isStreaming = false;
				activeResponseMd = null;
			}

			const label = formatToolLabel(event.toolName, args);
			const toolComp = new Text(toolStyle.icon.start("\u21B3") + " " + toolStyle.label(label), 1, 0);
			insertBeforeEditor(toolComp);

			showLoader(`Running ${event.toolName}...`);

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

			removeLoader();

			const isErr = !!(event as any).isError;
			const label = formatToolLabel(event.toolName, args);
			const duration = (durationMs / 1000).toFixed(1);
			const icon = isErr ? toolStyle.icon.error("\u2717") : toolStyle.icon.success("\u2713");
			const resultPreview = extractResultPreview(event.result, isErr);

			let resultLine = `${icon} ${toolStyle.label(label)} ${toolStyle.duration(`(${duration}s)`)}`;
			if (resultPreview) {
				resultLine += "\n" + toolStyle.result(`    ${resultPreview}`);
			}
			const resultComp = new Text(resultLine, 1, 0);
			insertBeforeEditor(resultComp);

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

			// Browser screenshots — display inline + send to status
			if (browserToolNames.has(event.toolName)) {
				const content = (event.result as any)?.content;
				if (Array.isArray(content)) {
					const img = content.find((c: any) => c.type === "image");
					if (img) {
						const imageComp = new Image(img.data, img.mimeType || "image/png", imageTheme);
						insertBeforeEditor(imageComp);

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
				updateHeader();

				if (isContextOverflow(msg as AssistantMessage)) {
					showCompactionMessage("Context overflow detected! Will compact after current run ends...");
					needsRetryAfterCompaction = true;
				}
			}
		}

		// Agent finished a complete run
		if (event.type === "agent_end") {
			removeLoader();

			// Emergency compaction + retry
			if (needsRetryAfterCompaction) {
				needsRetryAfterCompaction = false;
				responseText = "";
				isStreaming = false;
				hasError = false;
				activeResponseMd = null;

				const messages = [...agent.state.messages] as Message[];
				if (messages.length > 0) {
					const last = messages[messages.length - 1] as any;
					if (last.role === "assistant" && last.stopReason === "error") {
						messages.pop();
						agent.replaceMessages(messages);
					}
				}

				setTimeout(() => {
					compact(agent, model, (msg: string) => showCompactionMessage(msg)).then((result) => {
						if (result) {
							saveSessionMessages(agent.state.messages as Message[]);
							showCompactionMessage("Retrying after compaction...");
							setTimeout(() => agent.continue(), 0);
						} else {
							const errComp = new Text(chalk.red("  Compaction produced no result. Cannot retry."), 0, 0);
							insertBeforeEditor(errComp);
							agentBusy = false;
							editor.disableSubmit = false;
							tui.requestRender();
						}
					}).catch((err) => {
						const msg = err instanceof Error ? err.message : String(err);
						const errComp = new Text(chalk.red(`  Emergency compaction failed: ${msg}`), 0, 0);
						insertBeforeEditor(errComp);
						agentBusy = false;
						editor.disableSubmit = false;
						tui.requestRender();
					});
				}, 0);
				return;
			}

			// Check for errors
			if (!aborted && event.messages?.length) {
				for (const msg of event.messages) {
					const errorMsg = (msg as any).errorMessage;
					if (errorMsg) {
						const errComp = new Text(chalk.red(`  \u2717 ${errorMsg}`), 0, 0);
						insertBeforeEditor(errComp);
						hasError = true;
						status.addUpdate({
							type: "error",
							timestamp: Date.now(),
							content: errorMsg,
						});
					}
				}
			}

			// Show abort warning
			if (aborted && responseText) {
				const warnComp = new Text(chalk.yellow("  \u26A0 Response interrupted"), 0, 0);
				insertBeforeEditor(warnComp);
			}

			// Show turn stats
			const elapsed = turnStartTime > 0 ? Date.now() - turnStartTime : 0;
			const statParts: string[] = [];
			if (elapsed > 0) statParts.push(`${(elapsed / 1000).toFixed(1)}s`);
			if (lastInputTokens > 0) statParts.push(`${(lastInputTokens / 1000).toFixed(0)}K tokens`);
			if (statParts.length > 0) {
				const statsComp = new Text(chalk.dim(`  ${statParts.join(" \u00B7 ")}`), 0, 0);
				insertBeforeEditor(statsComp);
			}

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
				turnDuration: turnStartTime > 0 ? Date.now() - turnStartTime : 0,
				source: "repl",
			});

			// Reset state
			responseText = "";
			isStreaming = false;
			hasError = false;
			aborted = false;
			activeResponseMd = null;

			// Spacer between turns
			insertBeforeEditor(new Spacer(1));

			// Proactive compaction check, then re-enable editor
			checkAndCompact().finally(() => {
				agentBusy = false;
				editor.disableSubmit = false;
				tui.requestRender();
			});
		}
	});

	// -----------------------------------------------------------------------
	// Editor submit handler
	// -----------------------------------------------------------------------
	editor.onSubmit = async (value: string) => {
		const trimmed = value.trim();
		if (!trimmed) return;

		// Slash commands
		if (trimmed === "/exit") {
			tui.stop();
			try {
				await status.stop();
				await browser.close();
			} catch {
				// ignore
			}
			process.exit(0);
		}

		if (trimmed === "/new") {
			clearSession();
			agent.replaceMessages([]);
			// Remove all children except header, spacer after header, and editor
			const children = tui.children;
			// Keep first 2 (header + spacer) and last 1 (editor)
			children.splice(2, children.length - 3);
			const notice = new Text(chalk.dim("Session cleared."), 1, 0);
			children.splice(children.length - 1, 0, notice);
			children.splice(children.length - 1, 0, new Spacer(1));
			tui.requestRender();
			return;
		}

		if (trimmed === "/clear") {
			const children = tui.children;
			// Keep first 2 (header + spacer) and last 1 (editor)
			children.splice(2, children.length - 3);
			tui.requestRender();
			return;
		}

		if (trimmed === "/jobs") {
			const persona = options.persona;
			const allJobs = jobStore.list();
			const jobs = persona ? allJobs.filter((j) => j.persona === persona) : allJobs;
			if (jobs.length === 0) {
				const noJobs = new Text(chalk.dim(persona ? `No jobs for persona '${persona}'.` : "No jobs found."), 1, 0);
				insertBeforeEditor(noJobs);
			} else {
				const jobLines = jobs.map((j) => `  ${j.enabled ? chalk.green("\u2713") : chalk.dim("\u25CB")} ${j.id}: ${j.prompt.slice(0, 60)}`.trim());
				const jobsComp = new Text(chalk.bold("Jobs:\n") + jobLines.join("\n"), 1, 0);
				insertBeforeEditor(jobsComp);
			}
			return;
		}

		// Show user message with userMarkdownTheme + bgColor
		const userMd = new Markdown(trimmed, 1, 1, userMarkdownTheme, {
			bgColor: (text: string) => chalk.bgGray(text),
		});
		insertBeforeEditor(userMd);

		if (agentBusy) {
			// Steer agent with new instruction
			const steerNotice = new Text(chalk.yellow("  Steering agent with new instruction..."), 0, 0);
			insertBeforeEditor(steerNotice);
			const userMessage: Message = {
				role: "user",
				content: [{ type: "text", text: trimmed }],
				timestamp: Date.now(),
			};
			agent.steer(userMessage);
			return;
		}

		// Start new agent turn
		agentBusy = true;
		editor.disableSubmit = true;
		turnStartTime = Date.now();

		status.addUpdate({
			type: "turn_start",
			timestamp: Date.now(),
			content: trimmed.length > 100 ? trimmed.slice(0, 100) + "..." : trimmed,
			source: "repl",
		});

		showLoader("Thinking...");

		const userMessage: Message = {
			role: "user",
			content: [{ type: "text", text: trimmed }],
			timestamp: Date.now(),
		};

		try {
			await agent.prompt(userMessage);
			await agent.waitForIdle();
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			removeLoader();
			const errComp = new Text(chalk.red(`  \u2717 ${message}`), 0, 0);
			insertBeforeEditor(errComp);
			status.addUpdate({
				type: "error",
				timestamp: Date.now(),
				content: message,
			});
			agentBusy = false;
			editor.disableSubmit = false;
			tui.requestRender();
		}
	};

	// -----------------------------------------------------------------------
	// Ctrl+C handling via TUI input
	// -----------------------------------------------------------------------
	const originalHandleInput = editor.handleInput.bind(editor);
	editor.handleInput = (data: string) => {
		if (matchesKey(data, Key.ctrl("c"))) {
			if (agentBusy) {
				aborted = true;
				agent.abort();
				const interruptComp = new Text(chalk.yellow("  Interrupting..."), 0, 0);
				insertBeforeEditor(interruptComp);
				return;
			}
			// Not busy — exit
			tui.stop();
			status.stop().catch(() => {});
			browser.close().catch(() => {});
			process.exit(0);
		}
		originalHandleInput(data);
	};

	// -----------------------------------------------------------------------
	// Start
	// -----------------------------------------------------------------------
	await status.start();
	tui.start();
}
