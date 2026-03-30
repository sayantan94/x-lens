import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import { getModel, type Message } from "@mariozechner/pi-ai";
import { BrowserController } from "./browser.js";
import { createTools } from "./tools.js";
import { loadSkills, formatSkillsForPrompt } from "./skills.js";
import { StatusServer } from "./status-server.js";
import { renderMarkdown, renderError, renderToolStart, renderToolEnd, formatToolLabel, extractResultPreview } from "./render.js";
import { readMemory, readUser } from "./memory.js";
import { JobStore } from "./job-store.js";
import {
	createSession,
	endSession,
	insertMessage,
	incrementSessionCounts,
} from "./session-store.js";

export interface RunOptions {
	visible?: boolean;
	model?: string;
	provider?: string;
	persona?: string;
}

function resolveModel(options: RunOptions) {
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

function buildSystemPrompt(skills: ReturnType<typeof loadSkills>, memory: string, userProfile: string): string {
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

CRITICAL — Skill Usage Protocol:
1. BEFORE doing anything, scan the Available Skills list below for a match to the user's request
2. If ANY skill matches (even partially), you MUST call the tool named "skill_read" with parameter name="<skill-name>" to load its full instructions FIRST
3. Then follow the skill's instructions EXACTLY — do not freestyle when a skill exists
4. Only use general capabilities if NO skill matches the request
5. When using a skill, announce it: "Using skill: <name>"
6. NEVER make up results. If a command fails, debug it. If you cannot run the simulation, say so — do NOT fabricate data.

Tools:
- Browser for web tasks (navigate, click, type, scroll, screenshot)
- Shell for local commands and scripts
- Fetch for API calls (prefer this over browser for JSON APIs)
- Web search for Google queries

Always report back what you did and the outcome.

## Your Memory
${memory}

## User Profile
${userProfile}

## Autonomous Learning — IMPORTANT

You have a CLOSED LEARNING LOOP. Use it proactively:

### When to save to MEMORY (environment/project facts):
- You discover a tool quirk, API convention, or project pattern
- A command fails and you find the fix — save it so you don't repeat the mistake
- You learn about the codebase structure, deployment process, or infrastructure

### When to save to USER PROFILE (who the user is):
- User corrects your communication style ("don't explain so much", "I prefer tables")
- User shares their role, expertise, timezone, or workflow preferences
- User says "remember that I..." or "I always..."
- You notice the user's skill level in a domain (expert in Go, new to React)

### When to create/improve SKILLS:
- After completing a complex task (5+ tool calls) successfully — save the workflow as a skill
- When using a skill and finding it outdated or incomplete — patch it immediately
- When the user teaches you a recurring workflow — capture it as a skill

### When to search past sessions:
- User says "remember when we...", "last time", "as I mentioned", "we did this before"
- You need context from a prior conversation to avoid re-doing work
- Before asking the user to repeat information they may have already given you

Do NOT wait to be asked. Save proactively when any trigger above fires.

${skillsSection}`;
}

export async function runOnce(prompt: string, options: RunOptions = {}): Promise<void> {
	const browser = new BrowserController({ headless: !options.visible });
	const projectRoot = new URL("../..", import.meta.url).pathname;
	const skills = loadSkills(projectRoot, options.persona);
	const jobStore = new JobStore();
	const tools = createTools(browser, skills, jobStore, options.persona);
	const status = new StatusServer();

	const model = resolveModel(options);
	const memory = readMemory();
	const userProfile = readUser();

	const modelName = options.model || process.env.X_LENS_MODEL || "anthropic.claude-sonnet-4-20250514-v1:0";
	const sessionId = `cmd_${Date.now()}`;
	createSession({ id: sessionId, persona: options.persona || "", model: modelName });

	const agent = new Agent({
		initialState: {
			systemPrompt: buildSystemPrompt(skills, memory, userProfile),
			model,
			thinkingLevel: "off",
			tools,
		},
		convertToLlm,
	});

	const browserToolNames = new Set([
		"browser_navigate", "browser_screenshot", "browser_click",
		"browser_type", "browser_scroll",
	]);

	let responseText = "";
	let hasError = false;
	const toolStartTimes = new Map<string, { startTime: number; args: Record<string, unknown> }>();

	agent.subscribe((event: AgentEvent) => {
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			responseText += event.assistantMessageEvent.delta;
		}
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
				source: "cmd",
			});
		}
		if (event.type === "tool_execution_end") {
			const started = toolStartTimes.get(event.toolCallId);
			const durationMs = started ? Date.now() - started.startTime : 0;
			const args = started?.args ?? {};
			toolStartTimes.delete(event.toolCallId);

			const isErr = !!(event as any).isError;
			console.log(renderToolEnd(event.toolName, args, durationMs, event.result, isErr));

			status.addUpdate({
				type: "tool_end",
				timestamp: Date.now(),
				content: extractResultPreview(event.result, isErr),
				toolName: event.toolName,
				toolLabel: formatToolLabel(event.toolName, args),
				duration: durationMs,
				isError: isErr,
				source: "cmd",
			});

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
							source: "cmd",
						});
					}
				}
			}

			incrementSessionCounts(sessionId, 0, 1);
		}
		if (event.type === "message_end") {
			const msg = event.message as any;
			if (msg.role === "user" || msg.role === "assistant") {
				const text = Array.isArray(msg.content)
					? msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n")
					: String(msg.content || "");
				if (text.trim()) {
					insertMessage({ sessionId, role: msg.role, content: text });
					incrementSessionCounts(sessionId, 1, 0);
				}
			}
		}
		if (event.type === "agent_end") {
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
							source: "cmd",
						});
					}
				}
			}
			if (responseText && !hasError) {
				console.log("\n" + renderMarkdown(responseText));
			}
			responseText = "";
		}
	});

	try {
		await status.start();

		const userMessage: Message = {
			role: "user",
			content: [{ type: "text", text: prompt }],
			timestamp: Date.now(),
		};

		status.addUpdate({
			type: "turn_start",
			timestamp: Date.now(),
			content: prompt.length > 100 ? prompt.slice(0, 100) + "..." : prompt,
			source: "cmd",
		});

		await agent.prompt(userMessage);
		await agent.waitForIdle();

		status.addUpdate({
			type: "turn_end",
			timestamp: Date.now(),
			content: "",
			source: "cmd",
		});

		if (hasError) {
			process.exitCode = 1;
		}
	} finally {
		endSession(sessionId);
		await browser.close();
		await status.stop();
	}
}
