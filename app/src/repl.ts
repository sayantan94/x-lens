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
import { loadSkills } from "./skills.js";
import { buildUserAgentPrompt } from "./system-prompt.js";
import { StatusServer } from "./status-server.js";
import { formatToolLabel, extractResultPreview } from "./render.js";
import {
	readMemory,
	readUser,
	loadSessionMessages,
	appendSessionMessage,
	saveSessionMessages,
	clearSession,
} from "./memory.js";
import { shouldCompact, isContextOverflow, compact } from "./compaction.js";
import { JobStore } from "./job-store.js";
import {
	createSession,
	endSession,
	insertMessage,
	incrementSessionCounts,
} from "./session-store.js";
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
	const userProfile = readUser();

	// Handle session
	if (options.new) {
		clearSession();
	}

	const agent = new Agent({
		initialState: {
			systemPrompt: buildUserAgentPrompt({ skills, memory, userProfile, mode: "repl" }),
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

	// Derive names early — used for both session recording and TUI header
	const providerName = options.provider || "bedrock";
	const modelName = options.model || process.env.X_LENS_MODEL || (providerName === "anthropic" ? "claude-sonnet-4-20250514" : "anthropic.claude-sonnet-4-20250514-v1:0");

	// Session recording (SQLite)
	const sessionId = `repl_${Date.now()}`;
	createSession({ id: sessionId, persona: options.persona || "", model: modelName });

	// -----------------------------------------------------------------------
	// TUI setup
	// -----------------------------------------------------------------------
	const terminal = new ProcessTerminal();
	const tui = new TUI(terminal);
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
	let lastCtrlCTime = 0;

	// Natural-language abort commands recognised when the agent is busy
	const ABORT_COMMANDS = new Set(["stop", "abort", "cancel", "kill", "quit"]);

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

			// Finalize current text segment — reset so post-tool text gets a fresh component
			if (isStreaming) {
				isStreaming = false;
				activeResponseMd = null;
			}
			responseText = "";

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

			const headerLine = `${icon} ${toolStyle.label(label)} ${toolStyle.duration(`(${duration}s)`)}`;
			const headerComp = new Text(headerLine, 1, 0);
			insertBeforeEditor(headerComp);

			if (resultPreview) {
				// Show full multi-line tool output without dim styling
				const indented = resultPreview.split("\n").map((line: string) => `    ${line}`).join("\n");
				const outputComp = new Text(indented, 0, 0);
				insertBeforeEditor(outputComp);
			}

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

			incrementSessionCounts(sessionId, 0, 1);

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
			// Safety net: if the assistant message has text that wasn't streamed, render it now
			const endMsg = event.message as any;
			if (endMsg.role === "assistant" && Array.isArray(endMsg.content)) {
				const fullText = endMsg.content
					.filter((c: any) => c.type === "text" && c.text)
					.map((c: any) => c.text)
					.join("\n");
				if (fullText && fullText !== responseText && fullText.length > responseText.length) {
					// There's text we didn't render during streaming
					const unrendered = responseText.length === 0 ? fullText : fullText.slice(responseText.length);
					if (unrendered.trim()) {
						if (!isStreaming) {
							removeLoader();
							const md = new Markdown(unrendered, 1, 1, markdownTheme);
							insertBeforeEditor(md);
						} else if (activeResponseMd) {
							responseText = fullText;
							activeResponseMd.setText(responseText);
							tui.requestRender();
						}
					}
				}
			}
			// Finalize streaming state
			if (isStreaming) {
				isStreaming = false;
				activeResponseMd = null;
			}

			appendSessionMessage(event.message as Message);

			// Persist to SQLite session store
			const msgAny = event.message as any;
			if (msgAny.role === "user" || msgAny.role === "assistant") {
				const text = Array.isArray(msgAny.content)
					? msgAny.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n")
					: String(msgAny.content || "");
				if (text.trim()) {
					insertMessage({ sessionId, role: msgAny.role, content: text });
					incrementSessionCounts(sessionId, 1, 0);
				}
			}

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
					compact(agent, model, (msg: string) => showCompactionMessage(msg), true).then((result) => {
						if (result) {
							saveSessionMessages(agent.state.messages as Message[]);
							showCompactionMessage("Retrying after compaction...");
							setTimeout(() => agent.continue(), 0);
						} else {
							const errComp = new Text(chalk.red("  Compaction produced no result. Cannot retry."), 0, 0);
							insertBeforeEditor(errComp);
							agentBusy = false;
														tui.requestRender();
						}
					}).catch((err) => {
						const msg = err instanceof Error ? err.message : String(err);
						const errComp = new Text(chalk.red(`  Emergency compaction failed: ${msg}`), 0, 0);
						insertBeforeEditor(errComp);
						agentBusy = false;
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

			// Proactive compaction check, then process queued follow-ups
			checkAndCompact().finally(() => {
				// If follow-up messages were queued while busy, continue the agent
				if (agent.hasQueuedMessages()) {
					turnStartTime = Date.now();
					responseText = "";
					isStreaming = false;
					hasError = false;
					activeResponseMd = null;
					showLoader("Processing follow-up...");
					agent.continue().catch((err: unknown) => {
						const message = err instanceof Error ? err.message : String(err);
						removeLoader();
						const errComp = new Text(chalk.red(`  \u2717 ${message}`), 0, 0);
						insertBeforeEditor(errComp);
						agentBusy = false;
						tui.requestRender();
					});
				} else {
					agentBusy = false;
					tui.requestRender();
				}
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
			try { await status.stop(); } catch { /* ignore */ }
			await closeBrowserRaced(3000);
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
			// Abort commands interrupt immediately
			if (ABORT_COMMANDS.has(trimmed.toLowerCase())) {
				aborted = true;
				agent.abort();
				const interruptComp = new Text(chalk.yellow("  Stopping..."), 0, 0);
				insertBeforeEditor(interruptComp);
				return;
			}

			// Queue as follow-up — runs after current task finishes
			const followUpNotice = new Text(chalk.dim("  Queued — will run after current task"), 0, 0);
			insertBeforeEditor(followUpNotice);
			const userMessage: Message = {
				role: "user",
				content: [{ type: "text", text: trimmed }],
				timestamp: Date.now(),
			};
			agent.followUp(userMessage);
			return;
		}

		// Start new agent turn
		agentBusy = true;
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
						tui.requestRender();
		}
	};

	// -----------------------------------------------------------------------
	// Abort helper — single place that handles aborting the agent
	// -----------------------------------------------------------------------
	function doAbort(source: string) {
		if (!agentBusy) return;
		aborted = true;
		agent.abort();
		const interruptComp = new Text(chalk.yellow("  Stopping..."), 0, 0);
		insertBeforeEditor(interruptComp);
	}

	// Race browser close against a timeout so a stuck Playwright session
	// can't keep the REPL from exiting (Chromium would otherwise orphan).
	function closeBrowserRaced(timeoutMs = 3000) {
		return Promise.race([
			browser.close().catch(() => {}),
			new Promise((r) => setTimeout(r, timeoutMs)),
		]);
	}

	function doForceExit() {
		tui.stop();
		endSession(sessionId);
		status.stop().catch(() => {});
		closeBrowserRaced(1500).finally(() => process.exit(130));
	}

	function doCleanExit() {
		tui.stop();
		endSession(sessionId);
		import("./hive.js").then(({ endRun }) => {
			endRun({ id: sessionId, response: "(session ended)", status: "completed" });
		}).catch(() => {});
		status.stop().catch(() => {});
		closeBrowserRaced(3000).finally(() => process.exit(0));
	}

	// -----------------------------------------------------------------------
	// Ctrl+C handling via TUI input + process-level SIGINT fallback
	// -----------------------------------------------------------------------
	const originalHandleInput = editor.handleInput.bind(editor);
	editor.handleInput = (data: string) => {
		if (matchesKey(data, Key.ctrl("c"))) {
			const now = Date.now();
			if (agentBusy) {
				doAbort("ctrl-c");
				// Double Ctrl+C within 1s → force exit
				if (now - lastCtrlCTime < 1000) {
					doForceExit();
				}
				lastCtrlCTime = now;
				return;
			}
			// Not busy — exit cleanly
			doCleanExit();
		}
		originalHandleInput(data);
	};

	// Process-level SIGINT fallback — fires even if TUI input is stuck
	process.on("SIGINT", () => {
		const now = Date.now();
		if (agentBusy) {
			doAbort("sigint");
			if (now - lastCtrlCTime < 1000) {
				doForceExit();
			}
			lastCtrlCTime = now;
			return;
		}
		doCleanExit();
	});

	// Ctrl+Z suspend/resume — stop TUI before suspending, restart on resume
	process.on("SIGTSTP", () => {
		tui.stop();
		process.kill(process.pid, "SIGTSTP");
	});
	process.on("SIGCONT", () => {
		tui.start();
		tui.requestRender();
	});

	// -----------------------------------------------------------------------
	// Start
	// -----------------------------------------------------------------------

	// Record session in hive (one entry per REPL session, not per turn)
	try {
		const { startRun } = await import("./hive.js");
		startRun({ id: sessionId, source: "cli", persona: options.persona, prompt: "(interactive session)" });
	} catch { /* ignore */ }

	await status.start();
	tui.start();
}
