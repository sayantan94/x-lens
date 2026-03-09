import * as readline from "node:readline";
import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import { getModel, type AssistantMessage, type Message } from "@mariozechner/pi-ai";
import chalk from "chalk";
import { BrowserController } from "./browser.js";
import { createTools } from "./tools.js";
import { loadSkills, formatSkillsForPrompt } from "./skills.js";
import { StatusServer } from "./status-server.js";
import { renderMarkdown, renderError, renderToolStart, renderToolEnd, renderHeader, renderResponseStart, renderResponseEnd, formatToolLabel, extractResultPreview } from "./render.js";
import {
	readMemory,
	loadSessionMessages,
	appendSessionMessage,
	saveSessionMessages,
	clearSession,
} from "./memory.js";
import { shouldCompact, isContextOverflow, compact } from "./compaction.js";
import { JobStore } from "./job-store.js";

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

export async function runInteractive(options: ReplOptions = {}): Promise<void> {
	const browser = new BrowserController({ headless: !options.visible });
	const projectRoot = new URL("../..", import.meta.url).pathname;
	const skills = loadSkills(projectRoot, options.persona);
	const jobStore = new JobStore();
	const tools = createTools(browser, skills, jobStore);
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

	// Restore previous session — load full AgentMessages into the agent
	// This is the same pattern mom uses: sessionManager.buildSessionContext() + agent.replaceMessages()
	const previousMessages = loadSessionMessages();
	if (previousMessages.length > 0) {
		agent.replaceMessages(previousMessages);
	}

	// Track agent state
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

	// Track tool start times for duration calculation (like mom)
	const toolStartTimes = new Map<string, { startTime: number; args: Record<string, unknown> }>();

	// Compaction helper
	const logCompaction = (msg: string) => {
		console.log(chalk.magenta(`  ⟳ ${msg}`));
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
				// Persist the compacted session
				saveSessionMessages(agent.state.messages as Message[]);
				logCompaction(`Done. ${result.messagesRemoved} messages summarized, ${result.messagesKept} kept.`);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(chalk.red(`  Compaction failed: ${msg}`));
		}
	}

	// Subscribe to events ONCE (mom pattern — subscribe once, mutable run state)
	agent.subscribe((event: AgentEvent) => {
		// Collect streaming text — show dots as indicator
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			const delta = event.assistantMessageEvent.delta;
			if (!isStreaming) {
				process.stdout.write(chalk.dim("  ● Responding... (Ctrl+C to stop)"));
				isStreaming = true;
			}
			responseText += delta;
		}

		// Tool execution start — show label + args
		if (event.type === "tool_execution_start") {
			const args = (event.args ?? {}) as Record<string, unknown>;
			toolStartTimes.set(event.toolCallId, { startTime: Date.now(), args });
			console.log(renderToolStart(event.toolName, args));
			status.addUpdate({
				type: "tool_start",
				timestamp: Date.now(),
				content: "",
				toolName: event.toolName,
				toolLabel: formatToolLabel(event.toolName, args),
				source: "repl",
			});
		}

		// Tool execution end — show result preview + duration
		if (event.type === "tool_execution_end") {
			const started = toolStartTimes.get(event.toolCallId);
			const durationMs = started ? Date.now() - started.startTime : 0;
			const args = started?.args ?? {};
			toolStartTimes.delete(event.toolCallId);

			const isErr = !!(event as any).isError;
			console.log(renderToolEnd(event.toolName, args, durationMs, event.result, isErr));

			const resultPreview = extractResultPreview(event.result, isErr);
			status.addUpdate({
				type: "tool_end",
				timestamp: Date.now(),
				content: resultPreview,
				toolName: event.toolName,
				toolLabel: formatToolLabel(event.toolName, args),
				duration: durationMs,
				isError: isErr,
				source: "repl",
			});

			// Browser screenshots for status page
			if (browserToolNames.has(event.toolName)) {
				const content = (event.result as any)?.content;
				if (Array.isArray(content)) {
					const img = content.find((c: any) => c.type === "image");
					if (img) {
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

		// Track token usage + check for overflow on each assistant message
		if (event.type === "message_end") {
			appendSessionMessage(event.message as Message);

			// Track usage from assistant messages
			const msg = event.message as any;
			if (msg.role === "assistant" && msg.usage) {
				lastInputTokens = msg.usage.input || 0;
				lastOutputTokens = msg.usage.output || 0;
				lastCacheReadTokens = msg.usage.cacheRead || 0;
				lastCacheWriteTokens = msg.usage.cacheWrite || 0;

				// Check for overflow error — flag for compaction + retry after agent_end
				if (isContextOverflow(msg as AssistantMessage)) {
					logCompaction("Context overflow detected! Will compact after current run ends...");
					needsRetryAfterCompaction = true;
				}
			}
		}

		// Tool call after streaming — need separator
		if (event.type === "tool_execution_start" && isStreaming) {
			// Agent is doing more tool calls after some text — end the stream visually
			process.stdout.write("\n\n");
			isStreaming = false;
		}

		// Agent finished a complete run
		if (event.type === "agent_end") {
			// Emergency compaction + retry: agent has stopped, safe to compact and continue
			if (needsRetryAfterCompaction) {
				needsRetryAfterCompaction = false;
				responseText = "";
				isStreaming = false;
				hasError = false;

				// Remove the overflow error message from agent state
				const messages = [...agent.state.messages] as Message[];
				if (messages.length > 0) {
					const last = messages[messages.length - 1] as any;
					if (last.role === "assistant" && last.stopReason === "error") {
						messages.pop();
						agent.replaceMessages(messages);
					}
				}

				// Defer to next tick — agent_end fires from inside the agent loop,
				// the agent needs to fully unwind before we call continue()
				setTimeout(() => {
					compact(agent, model, logCompaction).then((result) => {
						if (result) {
							saveSessionMessages(agent.state.messages as Message[]);
							logCompaction("Retrying after compaction...");
							// Another tick to ensure compaction state is settled
							setTimeout(() => agent.continue(), 0);
						} else {
							console.error(renderError("Compaction produced no result. Cannot retry."));
							agentBusy = false;
						}
					}).catch((err) => {
						console.error(renderError(`Emergency compaction failed: ${err instanceof Error ? err.message : String(err)}`));
						agentBusy = false;
					});
				}, 0);
				return;
			}

			// Check for errors (skip error display if user aborted)
			if (!aborted && event.messages?.length) {
				for (const msg of event.messages) {
					const errorMsg = (msg as any).errorMessage;
					if (errorMsg) {
						console.error(renderError(errorMsg));
						hasError = true;
						status.addUpdate({
							type: "error",
							timestamp: Date.now(),
							content: errorMsg,
						});
					}
				}
			}

			// Clear streaming indicator
			if (isStreaming) {
				process.stdout.write("\r" + " ".repeat(60) + "\r");
			}

			// Show response (even partial on abort)
			if (responseText && !hasError) {
				console.log(renderResponseStart());
				console.log(renderMarkdown(responseText));
				if (aborted) {
					console.log(chalk.yellow("  ⚠ Response interrupted"));
				}
				const elapsed = turnStartTime > 0 ? Date.now() - turnStartTime : 0;
				console.log(renderResponseEnd(elapsed, lastInputTokens));
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

			responseText = "";
			isStreaming = false;
			hasError = false;
			aborted = false;

			// Check if we should proactively compact before next turn
			checkAndCompact().finally(() => {
				agentBusy = false;
			});
		}
	});

	await status.start();

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	console.log(renderHeader());

	if (previousMessages.length > 0) {
		console.log(chalk.dim(`  Resuming session (${previousMessages.length} messages). Use --new to start fresh.\n`));
	}

	// Ctrl+C: abort current run if busy, double-tap to exit
	let pendingExit = false;
	process.on("SIGINT", () => {
		if (agentBusy) {
			console.log(chalk.yellow("\n  Interrupting..."));
			aborted = true;
			agent.abort();
			return;
		}
		if (pendingExit) {
			process.exit(0);
		}
		pendingExit = true;
		console.log(chalk.dim("\n  Press Ctrl+C again or type 'exit' to quit.\n"));
		setTimeout(() => { pendingExit = false; }, 2000);
	});

	function promptUser(): void {
		rl.question(chalk.cyan("> "), async (input) => {
			const trimmed = input.trim();

			if (!trimmed) {
				promptUser();
				return;
			}

			if (trimmed === "exit" || trimmed === "quit") {
				console.log(chalk.dim("\n  Goodbye.\n"));
				rl.close();
				try {
					await status.stop();
					await browser.close();
				} catch {
					// ignore
				}
				process.exit(0);
			}

			// Build proper UserMessage (same structure mom uses)
			const userMessage: Message = {
				role: "user",
				content: [{ type: "text", text: trimmed }],
				timestamp: Date.now(),
			};

			if (agentBusy) {
				// Agent is mid-task — steer it with new instruction
				// This is exactly how mom handles new Slack messages while agent is working
				console.log(chalk.yellow("  Steering agent with new instruction..."));
				agent.steer(userMessage);
				promptUser();
				return;
			}

			agentBusy = true;
			turnStartTime = Date.now();
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
				console.error(renderError(message));
				status.addUpdate({
					type: "error",
					timestamp: Date.now(),
					content: message,
				});
				agentBusy = false;
			}

			promptUser();
		});
	}

	rl.on("close", async () => {
		try {
			await status.stop();
			await browser.close();
		} catch {
			// ignore
		}
		process.exit(0);
	});

	promptUser();
}
