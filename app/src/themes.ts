/**
 * TUI themes for x-lens components.
 * All styling uses chalk; types come from @mariozechner/pi-tui.
 */

import chalk from "chalk";
import type {
	SelectListTheme,
	MarkdownTheme,
	EditorTheme,
	ImageTheme,
} from "@mariozechner/pi-tui";

// ---------------------------------------------------------------------------
// Component themes
// ---------------------------------------------------------------------------

export const selectListTheme: SelectListTheme = {
	selectedPrefix: (text: string) => chalk.cyan(text),
	selectedText: (text: string) => chalk.bold(text),
	description: (text: string) => chalk.dim(text),
	scrollInfo: (text: string) => chalk.dim(text),
	noMatch: (text: string) => chalk.dim.italic(text),
};

export const markdownTheme: MarkdownTheme = {
	heading: (text: string) => chalk.bold.cyan(text),
	link: (text: string) => chalk.blue.underline(text),
	linkUrl: (text: string) => chalk.dim(text),
	code: (text: string) => chalk.yellow(text),
	codeBlock: (text: string) => chalk.green(text),
	codeBlockBorder: (text: string) => chalk.dim(text),
	quote: (text: string) => chalk.italic(text),
	quoteBorder: (text: string) => chalk.dim(text),
	hr: (text: string) => chalk.dim(text),
	listBullet: (text: string) => chalk.cyan(text),
	bold: (text: string) => chalk.bold(text),
	italic: (text: string) => chalk.italic(text),
	strikethrough: (text: string) => chalk.strikethrough(text),
	underline: (text: string) => chalk.underline(text),
};

export const userMarkdownTheme: MarkdownTheme = {
	...markdownTheme,
	heading: (text: string) => chalk.bold.white(text),
	code: (text: string) => chalk.magenta(text),
	listBullet: (text: string) => chalk.white(text),
};

export const editorTheme: EditorTheme = {
	borderColor: (text: string) => chalk.cyan(text),
	selectList: selectListTheme,
};

export const imageTheme: ImageTheme = {
	fallbackColor: (text: string) => chalk.dim(text),
};

// ---------------------------------------------------------------------------
// Tool display styling
// ---------------------------------------------------------------------------

export const toolStyle = {
	icon: {
		start: (text: string) => chalk.yellow(text),
		success: (text: string) => chalk.green(text),
		error: (text: string) => chalk.red(text),
	},
	label: (text: string) => chalk.yellow(text),
	args: (text: string) => chalk.dim(text),
	duration: (text: string) => chalk.dim(text),
	result: (text: string) => chalk.dim(text),
};

// ---------------------------------------------------------------------------
// Header / chrome styling
// ---------------------------------------------------------------------------

export const headerStyle = {
	brand: (text: string) => chalk.bold.cyan(text),
	separator: (text: string) => chalk.dim(text),
	info: (text: string) => chalk.dim(text),
	tokens: (text: string) => chalk.dim(text),
};
