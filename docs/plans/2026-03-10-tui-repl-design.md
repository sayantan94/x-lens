# TUI Chat Interface — Design

## Goal

Replace the readline-based REPL with a proper terminal UI using the `@mariozechner/pi-tui` framework already in the monorepo. Full chat interface with markdown rendering, inline screenshots, loading spinners, and multi-line editor.

## Architecture

The new REPL creates a `TUI` instance with three areas: header bar, scrollable message history, and a multi-line editor. The agent integration stays identical — same `Agent`, same `subscribe()` event handling, same session persistence. Only the rendering layer changes.

## Components and Layout

**Header** (`TruncatedText`): Shows persona, provider, model, token count. Updates after each turn.

```
x-lens · trader · bedrock · claude-sonnet-4 · 45K tokens
```

**User messages** (`Markdown` with background): Subtle background color to distinguish from assistant. Prepended with visual marker.

**Assistant messages** (`Markdown`, no background): Streamed text rendered as markdown. `setText()` called on each `text_delta` for live rendering.

**Tool calls** (`Text` with dimmed styling): Tool name + args on start, result preview + duration on end.

**Screenshots** (`Image`): Browser screenshots rendered inline via Kitty/iTerm2 graphics protocol. Text fallback on unsupported terminals.

**Loading** (`Loader`): Animated spinner while agent is working. Message updates contextually.

**Editor** (`Editor`): Multi-line input at bottom. Slash command autocomplete (`/exit`, `/new`, `/clear`, `/jobs`). `Ctrl+C` aborts current run.

## Agent Event Mapping

| Event | TUI Action |
|-------|-----------|
| `text_delta` | `markdownComponent.setText(responseText)` — live markdown |
| `tool_execution_start` | Insert `Text` with dimmed tool label + args |
| `tool_execution_end` | Update tool `Text` with result preview + duration |
| `agent_end` | Remove `Loader`, final markdown update, update header tokens |
| `message_end` | Update header with token count |
| Browser screenshot | Insert `Image` component inline |

**Streaming**: On first `text_delta`, create `Markdown` component. On each subsequent delta, call `setText()`. Differential rendering handles efficient updates.

**Abort**: `Ctrl+C` calls `agent.abort()`. Editor stays ready.

## What Changes

**Modified:** `app/src/repl.ts` — complete rewrite, replace readline with TUI

**Not changed:** `runner.ts`, `daemon.ts`, `tools.ts`, `skills.ts`, `memory.ts`, `compaction.ts`

**Dependencies:** Add `@mariozechner/pi-tui` to `app/package.json`

**Slash commands:** `/exit`, `/new`, `/clear`, `/jobs`

**Removed from repl.ts:** `readline`, `console.log` rendering, `render.ts` imports, manual streaming indicator

**Kept:** `resolveModel()`, `buildSystemPrompt()`, `convertToLlm()`, agent creation, session persistence, compaction, StatusServer, SIGINT handling
