import * as readline from "node:readline";
import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import { getModel, type AssistantMessage, type Message } from "@mariozechner/pi-ai";
import chalk from "chalk";
import { BrowserController } from "./browser.js";
import { createTools } from "./tools.js";
import { loadSkills, formatSkillsForPrompt } from "./skills.js";
import { StatusServer } from "./status-server.js";
import { renderMarkdown, renderError, renderToolStart, renderToolEnd, renderHeader } from "./render.js";
import { join } from "node:path";
import {
	readMemory,
	loadSessionMessages,
	appendSessionMessage,
	saveSessionMessages,
	clearSession,
} from "./memory.js";
import { shouldCompact, isContextOverflow, compact } from "./compaction.js";

export interface ReplOptions {
	visible?: boolean;
	model?: string;
	provider?: string;
	persona?: string;
	new?: boolean;
}

function resolveModel(options: ReplOptions) {
	const provider = options.provider || "bedrock";
	if (provider === "anthropic") {
		return getModel("anthropic", (options.model || "claude-sonnet-4-20250514") as any);
	}
	return getModel("amazon-bedrock", (options.model || "anthropic.claude-sonnet-4-20250514-v1:0") as any);
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
	const projectRoot = join(process.cwd(), "..");
	const skills = loadSkills(projectRoot, options.persona);
	const tools = createTools(browser, skills);
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
	let hasError = false;
	let lastInputTokens = 0;

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
		if (!shouldCompact(lastInputTokens, model.contextWindow)) return;

		logCompaction(`Context at ${lastInputTokens} tokens (limit: ${model.contextWindow}). Compacting...`);
		status.addUpdate({
			type: "message",
			timestamp: Date.now(),
			content: "Compacting conversation context...",
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
		// Collect streaming text
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			responseText += event.assistantMessageEvent.delta;
			status.addUpdate({
				type: "message",
				timestamp: Date.now(),
				content: event.assistantMessageEvent.delta,
			});
		}

		// Tool execution start — show label + args
		if (event.type === "tool_execution_start") {
			const args = (event.args ?? {}) as Record<string, unknown>;
			toolStartTimes.set(event.toolCallId, { startTime: Date.now(), args });
			console.log(renderToolStart(event.toolName, args));
			status.addUpdate({
				type: "tool",
				timestamp: Date.now(),
				content: `${event.toolName} ${JSON.stringify(args)}`,
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
				lastInputTokens = msg.usage.input + (msg.usage.cacheRead || 0);

				// Check for overflow error — need to compact and retry
				if (isContextOverflow(msg as AssistantMessage)) {
					logCompaction("Context overflow detected! Emergency compaction...");
					// Remove the error message from agent state
					const messages = [...agent.state.messages] as Message[];
					messages.pop(); // remove the error
					agent.replaceMessages(messages);

					// Compact and retry
					compact(agent, model, logCompaction).then((result) => {
						if (result) {
							saveSessionMessages(agent.state.messages as Message[]);
							logCompaction("Retrying after compaction...");
							agent.continue();
						}
					}).catch((err) => {
						console.error(renderError(`Emergency compaction failed: ${err instanceof Error ? err.message : String(err)}`));
						agentBusy = false;
					});
					return; // don't proceed to normal flow
				}
			}
		}

		// Agent finished a complete run
		if (event.type === "agent_end") {
			// Check for errors
			if (event.messages?.length) {
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

			// Render response as markdown
			if (responseText && !hasError) {
				console.log("\n" + renderMarkdown(responseText));
			}

			responseText = "";
			hasError = false;

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
			console.log(chalk.yellow("\n  Interrupting current task..."));
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
