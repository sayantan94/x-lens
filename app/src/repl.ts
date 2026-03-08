import * as readline from "node:readline";
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { BrowserController } from "./browser.js";
import { createBrowserTools } from "./tools.js";
import { loadSkills, formatSkillsForPrompt } from "./skills.js";
import { StatusServer } from "./status-server.js";
import { join } from "node:path";

export interface ReplOptions {
  visible?: boolean;
  model?: string;
  skillsDir?: string;
}

function buildSystemPrompt(skills: ReturnType<typeof loadSkills>): string {
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

${skillsSection}`;
}

export async function runInteractive(options: ReplOptions = {}): Promise<void> {
  const browser = new BrowserController({ headless: !options.visible });
  const tools = createBrowserTools(browser);
  const skillsDir = options.skillsDir || join(process.cwd(), "skills");
  const skills = loadSkills(skillsDir);
  const status = new StatusServer();

  const model = getModel("amazon-bedrock", (options.model || "anthropic.claude-sonnet-4-20250514-v1:0") as any);

  const agent = new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt(skills),
      model,
      thinkingLevel: "off",
      tools,
    },
  });

  const browserToolNames = new Set([
    "browser_navigate", "browser_screenshot", "browser_click",
    "browser_type", "browser_scroll",
  ]);

  agent.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      process.stdout.write(event.assistantMessageEvent.delta);
      status.addUpdate({
        type: "message",
        timestamp: Date.now(),
        content: event.assistantMessageEvent.delta,
      });
    }
    if (event.type === "tool_execution_start") {
      process.stderr.write(`\n[tool] ${event.toolName}...\n`);
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
      process.stdout.write("\n");
    }
  });

  await status.start();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("x-lens \u2014 personal agent");
  console.log('Type your request, or "exit" to quit.\n');

  function prompt(): void {
    rl.question("> ", async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed === "exit" || trimmed === "quit") {
        console.log("Goodbye.");
        rl.close();
        try {
          await status.stop();
          await browser.close();
        } catch {
          // ignore close errors
        }
        process.exit(0);
      }

      try {
        await agent.prompt(trimmed);
        await agent.waitForIdle();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`\n[error] ${message}\n`);
        status.addUpdate({
          type: "error",
          timestamp: Date.now(),
          content: message,
        });
      }

      prompt();
    });
  }

  // Handle Ctrl+C gracefully
  rl.on("close", async () => {
    try {
      await status.stop();
      await browser.close();
    } catch {
      // ignore close errors
    }
    process.exit(0);
  });

  prompt();
}
