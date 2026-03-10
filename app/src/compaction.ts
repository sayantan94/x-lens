/**
 * Context compaction for long sessions.
 *
 * Simplified version of pi-coding-agent's compaction system.
 * When the conversation approaches the context window limit, we:
 * 1. Serialize the conversation to text
 * 2. Ask the LLM to summarize it
 * 3. Replace old messages with a summary + keep recent messages
 *
 * Also handles overflow recovery (API returns "prompt too long").
 */

import type { Agent } from "@mariozechner/pi-agent-core";
import type { Api, AssistantMessage, Message, Model } from "@mariozechner/pi-ai";
import { completeSimple } from "@mariozechner/pi-ai";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Tokens reserved for prompt + response headroom (must be >= max_tokens sent to API) */
const RESERVE_TOKENS = 40000;

/** Recent tokens to keep after compaction (not summarized) */
const KEEP_RECENT_TOKENS = 20000;

/** Approximate chars per token for estimation */
const CHARS_PER_TOKEN = 4;

// ---------------------------------------------------------------------------
// Overflow detection (from pi-ai)
// ---------------------------------------------------------------------------

const OVERFLOW_PATTERNS = [
	/prompt is too long/i,
	/input is too long for requested model/i,
	/exceeds the context window/i,
	/input token count.*exceeds the maximum/i,
	/maximum prompt length is \d+/i,
	/reduce the length of the messages/i,
	/maximum context length is \d+ tokens/i,
	/exceeds the limit of \d+/i,
	/exceeds the available context size/i,
	/context[_ ]length[_ ]exceeded/i,
	/too many tokens/i,
	/token limit exceeded/i,
	/input length and.*max_tokens.*exceed/i,
	/exceed context limit/i,
];

export function isContextOverflow(message: AssistantMessage): boolean {
	if (message.stopReason === "error" && message.errorMessage) {
		return OVERFLOW_PATTERNS.some((p) => p.test(message.errorMessage!));
	}
	return false;
}

// ---------------------------------------------------------------------------
// Threshold check
// ---------------------------------------------------------------------------

export function shouldCompact(inputTokens: number, contextWindow: number): boolean {
	return inputTokens > contextWindow - RESERVE_TOKENS;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function serializeMessages(messages: Message[]): string {
	const parts: string[] = [];

	for (const msg of messages) {
		if (msg.role === "user") {
			const text = extractText(msg.content);
			if (text) parts.push(`[User]: ${text}`);
		} else if (msg.role === "assistant") {
			const am = msg as AssistantMessage;
			const textParts: string[] = [];
			const toolCalls: string[] = [];
			if (Array.isArray(am.content)) {
				for (const part of am.content) {
					if (part.type === "text" && part.text) {
						textParts.push(part.text);
					} else if (part.type === "toolCall") {
						const argsStr = JSON.stringify(part.arguments ?? {});
						const truncArgs = argsStr.length > 200 ? argsStr.slice(0, 200) + "..." : argsStr;
						toolCalls.push(`${part.name}(${truncArgs})`);
					}
				}
			}
			if (toolCalls.length > 0) {
				parts.push(`[Assistant tool calls]: ${toolCalls.join(", ")}`);
			}
			if (textParts.length > 0) {
				parts.push(`[Assistant]: ${textParts.join("\n")}`);
			}
		} else if (msg.role === "toolResult") {
			const text = extractText((msg as any).content);
			// Truncate large tool results (screenshots, long API responses)
			const truncated = text && text.length > 500 ? text.slice(0, 500) + "...[truncated]" : text;
			if (truncated) parts.push(`[Tool result]: ${truncated}`);
		}
	}

	return parts.join("\n\n");
}

function extractText(content: unknown): string | null {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const texts: string[] = [];
		for (const part of content) {
			if (part.type === "text" && part.text) texts.push(part.text);
			// Skip images — they're too large and not useful for summaries
		}
		return texts.length > 0 ? texts.join("\n") : null;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Summary generation
// ---------------------------------------------------------------------------

const SUMMARIZATION_SYSTEM_PROMPT = `You are a conversation summarizer. Summarize the conversation concisely, preserving:
- What the user asked for and why
- What was accomplished (actions taken, results)
- Key data and findings (prices, tickers, numbers, URLs)
- Any preferences or context the user shared
- What is currently in progress or planned next

Use structured sections. Be precise — include exact values, file paths, and tool outputs that matter.
Keep it under 2000 words.`;

const SUMMARY_USER_PROMPT = `Summarize this conversation for context continuity. The summary will replace the conversation history so the assistant can continue helping without losing context.

<conversation>
{conversation}
</conversation>

Respond with the summary only, no preamble.`;

const UPDATE_SUMMARY_PROMPT = `Update this existing summary with new conversation context. Merge new information, move completed items from "in progress" to "done", and add any new findings.

<existing_summary>
{existingSummary}
</existing_summary>

<new_conversation>
{conversation}
</new_conversation>

Respond with the updated summary only, no preamble.`;

async function generateSummary(
	messages: Message[],
	model: Model<Api>,
	existingSummary?: string,
): Promise<string> {
	const conversationText = serializeMessages(messages);

	let userPrompt: string;
	if (existingSummary) {
		userPrompt = UPDATE_SUMMARY_PROMPT
			.replace("{existingSummary}", existingSummary)
			.replace("{conversation}", conversationText);
	} else {
		userPrompt = SUMMARY_USER_PROMPT.replace("{conversation}", conversationText);
	}

	const userMessage: Message = {
		role: "user",
		content: [{ type: "text", text: userPrompt }],
		timestamp: Date.now(),
	};

	const result = await completeSimple(model, {
		systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
		messages: [userMessage],
	}, { maxTokens: 4096 });

	// Extract text from response
	const textParts = (result.content as any[])
		.filter((c: any) => c.type === "text")
		.map((c: any) => c.text);
	return textParts.join("\n");
}

// ---------------------------------------------------------------------------
// Compaction execution
// ---------------------------------------------------------------------------

export interface CompactionResult {
	summary: string;
	tokensBefore: number;
	messagesRemoved: number;
	messagesKept: number;
}

/**
 * Find the cut point — keep enough recent messages to stay under KEEP_RECENT_TOKENS.
 * Returns the index where we start keeping messages.
 */
function findCutPoint(messages: Message[]): number {
	let tokenEstimate = 0;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		const text = extractText((msg as any).content) ?? "";
		tokenEstimate += Math.ceil(text.length / CHARS_PER_TOKEN);
		if (tokenEstimate > KEEP_RECENT_TOKENS) {
			return i + 1;
		}
	}
	return 0; // keep everything (shouldn't happen if compaction was triggered)
}

/**
 * Run compaction on the agent's messages.
 * Summarizes old messages, keeps recent ones, and replaces the agent's context.
 */
export async function compact(
	agent: Agent,
	model: Model<Api>,
	log?: (msg: string) => void,
): Promise<CompactionResult | null> {
	const messages = agent.state.messages as Message[];
	if (messages.length < 4) return null; // nothing meaningful to compact

	const cutPoint = findCutPoint(messages);
	if (cutPoint <= 1) return null; // not enough to summarize

	const toSummarize = messages.slice(0, cutPoint);
	const toKeep = messages.slice(cutPoint);

	log?.(`Compacting: summarizing ${toSummarize.length} messages, keeping ${toKeep.length}`);

	// Check if first message is already a summary (incremental compaction)
	let existingSummary: string | undefined;
	const firstMsg = toSummarize[0];
	if (firstMsg.role === "user" && Array.isArray(firstMsg.content)) {
		const text = extractText(firstMsg.content) ?? "";
		if (text.startsWith("The conversation history before this point")) {
			const match = text.match(/<summary>([\s\S]*?)<\/summary>/);
			if (match) existingSummary = match[1].trim();
		}
	}

	const summary = await generateSummary(
		existingSummary ? toSummarize.slice(1) : toSummarize,
		model,
		existingSummary,
	);

	// Build new message list: summary as user message + kept messages
	const summaryMessage: Message = {
		role: "user",
		content: [
			{
				type: "text",
				text: `The conversation history before this point was compacted into the following summary:\n\n<summary>\n${summary}\n</summary>`,
			},
		],
		timestamp: Date.now(),
	};

	const newMessages = [summaryMessage, ...toKeep];
	agent.replaceMessages(newMessages);

	const result: CompactionResult = {
		summary,
		tokensBefore: messages.reduce((acc, m) => {
			const text = extractText((m as any).content) ?? "";
			return acc + Math.ceil(text.length / CHARS_PER_TOKEN);
		}, 0),
		messagesRemoved: toSummarize.length,
		messagesKept: toKeep.length,
	};

	log?.(`Compaction done: ${result.messagesRemoved} messages summarized, ${result.messagesKept} kept`);

	return result;
}
