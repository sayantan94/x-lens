import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";
import chalk from "chalk";

const marked = new Marked(markedTerminal() as any);

export function renderMarkdown(text: string): string {
	const rendered = marked.parse(text) as string;
	return rendered.trimEnd();
}

export function renderError(message: string): string {
	return chalk.red(`\n  ✗ ${message}\n`);
}

export function renderToolStart(toolName: string, args: Record<string, unknown>): string {
	const label = formatToolLabel(toolName, args);
	const argsPreview = formatArgsPreview(args);
	const parts = [chalk.yellow(`  ↳ ${label}`)];
	if (argsPreview) {
		parts.push(chalk.dim(`    ${argsPreview}`));
	}
	return parts.join("\n");
}

export function renderToolEnd(toolName: string, args: Record<string, unknown>, durationMs: number, result: unknown, isError: boolean): string {
	const label = formatToolLabel(toolName, args);
	const duration = (durationMs / 1000).toFixed(1);
	const icon = isError ? chalk.red("✗") : chalk.green("✓");
	const header = `  ${icon} ${chalk.yellow(label)} ${chalk.dim(`(${duration}s)`)}`;

	const resultPreview = extractResultPreview(result, isError);
	if (resultPreview) {
		return `${header}\n${chalk.dim(`    ${resultPreview}`)}`;
	}
	return header;
}

export function renderResponseStart(): string {
	const line = chalk.dim("  ─".repeat(30));
	return `\n${line}\n`;
}

export function renderResponseEnd(durationMs: number, inputTokens: number): string {
	const parts: string[] = [];
	if (durationMs > 0) parts.push(`${(durationMs / 1000).toFixed(1)}s`);
	if (inputTokens > 0) parts.push(`${(inputTokens / 1000).toFixed(0)}K tokens`);
	if (parts.length === 0) return "";
	return chalk.dim(`\n  ${parts.join(" · ")}\n`);
}

export function renderHeader(): string {
	return [
		"",
		chalk.bold.cyan("  x-lens"),
		chalk.dim("  personal agent"),
		"",
		chalk.dim('  Type your request, or "exit" to quit.'),
		"",
	].join("\n");
}

/** Render a text delta for live streaming to the terminal */
export function renderStreamDelta(delta: string): string {
	return delta;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatToolLabel(toolName: string, args: Record<string, unknown>): string {
	switch (toolName) {
		case "browser_navigate":
			return `Navigate → ${truncate(String(args.url || ""), 80)}`;
		case "browser_click":
			return `Click → ${truncate(String(args.selector || ""), 60)}`;
		case "browser_type":
			return `Type "${truncate(String(args.text || ""), 40)}" → ${truncate(String(args.selector || ""), 40)}`;
		case "browser_scroll":
			return `Scroll ${args.direction || "down"} ${args.amount || 500}px`;
		case "browser_screenshot":
			return "Screenshot";
		case "browser_evaluate":
			return `Evaluate JS: ${truncate(String(args.expression || ""), 60)}`;
		case "web_search":
			return `Search → "${truncate(String(args.query || ""), 60)}"`;
		case "shell":
			return `Shell → ${truncate(String(args.command || ""), 80)}`;
		case "fetch":
			return `${(args.method as string || "GET").toUpperCase()} → ${truncate(String(args.url || ""), 80)}`;
		case "skill_read":
			return `Read skill → ${args.name || "?"}`;
		case "memory_read":
			return "Read memory";
		case "memory_write":
			return "Write memory";
		case "memory_append":
			return "Append to memory";
		default:
			return toolName;
	}
}

function formatArgsPreview(args: Record<string, unknown>): string {
	if (args.command && typeof args.command === "string") {
		const cmd = args.command;
		if (cmd.length > 120) return truncate(cmd, 120);
		return "";
	}
	return "";
}

export function extractResultPreview(result: unknown, isError: boolean): string {
	if (!result) return "";

	const content = (result as any)?.content;
	if (Array.isArray(content)) {
		const textParts: string[] = [];
		for (const part of content) {
			if (part.type === "text" && part.text) {
				textParts.push(part.text);
			} else if (part.type === "image") {
				textParts.push("[screenshot]");
			}
		}
		const fullText = textParts.join(" | ");
		if (!fullText) return "";

		return fullText.replace(/\n/g, " ↵ ");
	}

	if (typeof result === "string") {
		return result.replace(/\n/g, " ↵ ");
	}

	return "";
}

function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return text.slice(0, maxLen - 3) + "...";
}
