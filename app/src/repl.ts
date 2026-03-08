import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import {
	TUI, ProcessTerminal, Container, Editor, Markdown, Loader, Text,
	type EditorTheme, type SelectListTheme, type MarkdownTheme,
	matchesKey, Key,
} from "@mariozechner/pi-tui";
import chalk from "chalk";
import { BrowserController } from "./browser.js";
import { createBrowserTools } from "./tools.js";
import { loadSkills, formatSkillsForPrompt } from "./skills.js";
import { StatusServer } from "./status-server.js";
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

// -- Themes --

const selectListTheme: SelectListTheme = {
	selectedPrefix: (s) => chalk.cyan(s),
	selectedText: (s) => chalk.cyan(s),
	description: (s) => chalk.dim(s),
	scrollInfo: (s) => chalk.dim(s),
	noMatch: (s) => chalk.dim(s),
};

const editorTheme: EditorTheme = {
	borderColor: (s) => chalk.cyan(s),
	selectList: selectListTheme,
};

const markdownTheme: MarkdownTheme = {
	heading: (s) => chalk.bold.cyan(s),
	link: (s) => chalk.blue(s),
	linkUrl: (s) => chalk.blue.underline(s),
	code: (s) => chalk.yellow(s),
	codeBlock: (s) => chalk.gray(s),
	codeBlockBorder: (s) => chalk.dim(s),
	quote: (s) => chalk.italic.gray(s),
	quoteBorder: (s) => chalk.dim(s),
	hr: (s) => chalk.dim(s),
	listBullet: (s) => chalk.cyan(s),
	bold: (s) => chalk.bold(s),
	italic: (s) => chalk.italic(s),
	strikethrough: (s) => chalk.strikethrough(s),
	underline: (s) => chalk.underline(s),
};

export async function runInteractive(options: ReplOptions = {}): Promise<void> {
	const browser = new BrowserController({ headless: !options.visible });
	const tools = createBrowserTools(browser);
	const skillsDir = options.skillsDir || join(process.cwd(), "skills");
	const skills = loadSkills(skillsDir);
	const status = new StatusServer();

	const model = resolveModel(options);
	const memory = readMemory();

	// Handle session: clear if --new, otherwise load previous
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

	// -- TUI Setup --
	const terminal = new ProcessTerminal();
	const ui = new TUI(terminal, true);

	// Header
	const header = new Text(
		chalk.bold.cyan("  x-lens") + chalk.dim("  personal agent") + chalk.dim("  (ctrl+c to quit)"),
		0, 0,
	);

	// Chat area — holds all messages
	const chatContainer = new Container();

	// Editor for user input
	const editor = new Editor(ui, editorTheme);

	// Root layout
	const root = new Container();
	root.addChild(header);
	root.addChild(chatContainer);
	root.addChild(editor);
	ui.addChild(root);
	ui.setFocus(editor);

	// -- Agent event handling --
	const browserToolNames = new Set([
		"browser_navigate", "browser_screenshot", "browser_click",
		"browser_type", "browser_scroll",
	]);

	let responseText = "";
	let currentResponseComponent: Markdown | null = null;
	let currentLoader: Loader | null = null;

	function addUserMessage(text: string) {
		const msg = new Text(chalk.bold.green("  > ") + chalk.white(text), 0, 0);
		chatContainer.addChild(msg);
		ui.requestRender();
	}

	function showLoader(message: string) {
		if (currentLoader) {
			currentLoader.stop();
			chatContainer.removeChild(currentLoader);
		}
		currentLoader = new Loader(
			ui,
			(s) => chalk.cyan(s),
			(s) => chalk.dim(s),
			message,
		);
		chatContainer.addChild(currentLoader);
		ui.requestRender();
	}

	function hideLoader() {
		if (currentLoader) {
			currentLoader.stop();
			chatContainer.removeChild(currentLoader);
			currentLoader = null;
			ui.requestRender();
		}
	}

	function showError(message: string) {
		const err = new Text(chalk.red("  ✗ ") + chalk.red(message), 0, 0);
		chatContainer.addChild(err);
		ui.requestRender();
	}

	function updateResponseMarkdown() {
		if (!currentResponseComponent) {
			currentResponseComponent = new Markdown(responseText, 1, 0, markdownTheme);
			chatContainer.addChild(currentResponseComponent);
		} else {
			currentResponseComponent.setText(responseText);
		}
		ui.requestRender();
	}

	// Restore previous session messages in the chat UI
	for (const entry of previousSession) {
		if (entry.role === "user") {
			addUserMessage(entry.content);
		} else if (entry.role === "assistant") {
			const md = new Markdown(entry.content, 1, 0, markdownTheme);
			chatContainer.addChild(md);
			chatContainer.addChild(new Text("", 0, 0));
		}
	}

	agent.subscribe((event) => {
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			hideLoader();
			responseText += event.assistantMessageEvent.delta;
			updateResponseMarkdown();
			status.addUpdate({
				type: "message",
				timestamp: Date.now(),
				content: event.assistantMessageEvent.delta,
			});
		}
		if (event.type === "tool_execution_start") {
			showLoader(event.toolName);
			status.addUpdate({
				type: "tool",
				timestamp: Date.now(),
				content: `${event.toolName} ${JSON.stringify(event.args)}`,
			});
		}
		if (event.type === "tool_execution_end") {
			hideLoader();
			if (browserToolNames.has(event.toolName)) {
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
		}
		if (event.type === "agent_end") {
			hideLoader();
			// Check for errors
			if (event.messages?.length) {
				for (const msg of event.messages) {
					const errorMsg = (msg as any).errorMessage;
					if (errorMsg) {
						showError(errorMsg);
						status.addUpdate({
							type: "error",
							timestamp: Date.now(),
							content: errorMsg,
						});
					}
				}
			}
			// Save assistant response to session
			if (responseText) {
				appendToSession({
					timestamp: new Date().toISOString(),
					role: "assistant",
					content: responseText,
				});
				chatContainer.addChild(new Text("", 0, 0));
			}
			// Reset for next turn
			responseText = "";
			currentResponseComponent = null;
			ui.requestRender();
		}
	});

	// -- Editor submit handler --
	let isProcessing = false;

	editor.onSubmit = async (text: string) => {
		const trimmed = text.trim();
		if (!trimmed || isProcessing) return;

		if (trimmed === "exit" || trimmed === "quit") {
			await cleanup();
			return;
		}

		editor.setText("");
		editor.addToHistory(trimmed);
		addUserMessage(trimmed);
		appendToSession({
			timestamp: new Date().toISOString(),
			role: "user",
			content: trimmed,
		});
		showLoader("Thinking...");
		isProcessing = true;

		try {
			await agent.prompt(trimmed);
			await agent.waitForIdle();
		} catch (err: unknown) {
			hideLoader();
			const message = err instanceof Error ? err.message : String(err);
			showError(message);
			status.addUpdate({
				type: "error",
				timestamp: Date.now(),
				content: message,
			});
		}

		isProcessing = false;
		ui.requestRender();
	};

	// -- Cleanup --
	async function cleanup() {
		ui.stop();
		try {
			await status.stop();
			await browser.close();
		} catch {
			// ignore
		}
		process.exit(0);
	}

	// -- Start --
	await status.start();
	ui.start();
}
