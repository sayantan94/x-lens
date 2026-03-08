import * as readline from "node:readline";
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import chalk from "chalk";
import { BrowserController } from "./browser.js";
import { createBrowserTools } from "./tools.js";
import { loadSkills, formatSkillsForPrompt } from "./skills.js";
import { StatusServer } from "./status-server.js";
import { renderMarkdown, renderError, renderToolUsage, renderHeader } from "./render.js";
import { join } from "node:path";
import { readMemory, appendToSession, loadSession, clearSession } from "./memory.js";

export interface ReplOptions {
	visible?: boolean;
	model?: string;
	provider?: string;
	skillsDir?: string;
	new?: boolean;
}

function resolveModel(options: ReplOptions) {
	const provider = options.provider || "bedrock";
	if (provider === "anthropic") {
		return getModel("anthropic", (options.model || "claude-sonnet-4-20250514") as any);
	}
	return getModel("amazon-bedrock", (options.model || "anthropic.claude-sonnet-4-20250514-v1:0") as any);
}

function buildSystemPrompt(skills: ReturnType<typeof loadSkills>, memory: string): string {
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

## Your Memory
${memory}

You can save important information using the memory_write or memory_append tools.
Save things like: user preferences, frequently used URLs, login info hints, recurring tasks.

${skillsSection}`;
}

export async function runInteractive(options: ReplOptions = {}): Promise<void> {
	const browser = new BrowserController({ headless: !options.visible });
	const tools = createBrowserTools(browser);
	const skillsDir = options.skillsDir || join(process.cwd(), "skills");
	const skills = loadSkills(skillsDir);
	const status = new StatusServer();

	const model = resolveModel(options);
	const memory = readMemory();

	// Handle session
	if (options.new) {
		clearSession();
	}
	const previousSession = loadSession();

	const agent = new Agent({
		initialState: {
			systemPrompt: buildSystemPrompt(skills, memory),
			model,
			thinkingLevel: "off",
			tools,
		},
	});

	// Collect response text, render as markdown at end
	let responseText = "";
	let hasError = false;

	const browserToolNames = new Set([
		"browser_navigate", "browser_screenshot", "browser_click",
		"browser_type", "browser_scroll",
	]);

	agent.subscribe((event) => {
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			responseText += event.assistantMessageEvent.delta;
			status.addUpdate({
				type: "message",
				timestamp: Date.now(),
				content: event.assistantMessageEvent.delta,
			});
		}
		if (event.type === "tool_execution_start") {
			console.log(renderToolUsage(event.toolName));
			status.addUpdate({
				type: "tool",
				timestamp: Date.now(),
				content: `${event.toolName} ${JSON.stringify(event.args)}`,
			});
		}
		if (event.type === "tool_execution_end" && browserToolNames.has(event.toolName)) {
			const result = event.result as any;
			const content = result?.content;
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
				appendToSession({
					timestamp: new Date().toISOString(),
					role: "assistant",
					content: responseText,
				});
			}
			responseText = "";
			hasError = false;
		}
	});

	await status.start();

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	console.log(renderHeader());

	// Show previous session summary if resuming
	if (previousSession.length > 0) {
		console.log(chalk.dim(`  Resuming session (${previousSession.length} messages). Use --new to start fresh.\n`));
	}

	function prompt(): void {
		rl.question(chalk.cyan("> "), async (input) => {
			const trimmed = input.trim();

			if (!trimmed) {
				prompt();
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

			// Save user message to session
			appendToSession({
				timestamp: new Date().toISOString(),
				role: "user",
				content: trimmed,
			});

			try {
				await agent.prompt(trimmed);
				await agent.waitForIdle();
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(renderError(message));
				status.addUpdate({
					type: "error",
					timestamp: Date.now(),
					content: message,
				});
			}

			prompt();
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

	prompt();
}
