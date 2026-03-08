import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";
import chalk from "chalk";

const marked = new Marked(markedTerminal() as any);

export function renderMarkdown(text: string): string {
	const rendered = marked.parse(text) as string;
	// marked-terminal adds a trailing newline, trim it
	return rendered.trimEnd();
}

export function renderError(message: string): string {
	return chalk.red(`\n  ✗ ${message}\n`);
}

export function renderToolUsage(toolName: string): string {
	return chalk.dim(`  ⟩ ${toolName}`);
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
