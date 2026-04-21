import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import { getModel, type Message } from "@mariozechner/pi-ai";
import { BrowserController } from "./browser.js";
import { createTools } from "./tools.js";
import { loadSkills } from "./skills.js";
import { buildUserAgentPrompt } from "./system-prompt.js";
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
	pipe?: boolean;
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
			systemPrompt: buildUserAgentPrompt({ skills, memory, userProfile, mode: "runner" }),
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

	const isPipe = !!options.pipe;

	agent.subscribe((event: AgentEvent) => {
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			responseText += event.assistantMessageEvent.delta;
		}
		if (event.type === "tool_execution_start") {
			const args = (event.args ?? {}) as Record<string, unknown>;
			toolStartTimes.set(event.toolCallId, { startTime: Date.now(), args });
			if (!isPipe) {
				console.log(renderToolStart(event.toolName, args));
			}
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
			if (!isPipe) {
				console.log(renderToolEnd(event.toolName, args, durationMs, event.result, isErr));
			}

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
						if (isPipe) {
							console.error(errorMsg);
						} else {
							console.error(renderError(errorMsg));
						}
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
				if (isPipe) {
					// Pipe mode: raw text, no markdown rendering
					process.stdout.write(responseText);
				} else {
					console.log("\n" + renderMarkdown(responseText));
				}
			}
			responseText = "";
		}
	});

	// Auto-record run in hive
	let toolCallCount = 0;
	const origSubscribe = agent.subscribe((event: AgentEvent) => {
		if (event.type === "tool_execution_end") toolCallCount++;
	});

	try {
		const { startRun, endRun } = await import("./hive.js");
		startRun({ id: sessionId, source: isPipe ? "pipe" : "cli", persona: options.persona, prompt });

		if (!isPipe) await status.start();

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

		endRun({
			id: sessionId,
			response: responseText.slice(0, 10000),
			status: hasError ? "error" : "completed",
			error_message: hasError ? "See session log" : undefined,
			tool_count: toolCallCount,
		});

		if (hasError) {
			process.exitCode = 1;
		}
	} catch (err) {
		try {
			const { endRun } = await import("./hive.js");
			endRun({ id: sessionId, response: "", status: "error", error_message: String(err) });
		} catch { /* ignore hive errors */ }
		throw err;
	} finally {
		origSubscribe();
		endSession(sessionId);
		await browser.close();
		if (!isPipe) await status.stop();
	}
}
