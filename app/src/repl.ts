import * as readline from "node:readline";
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { BrowserController } from "./browser.js";
import { createBrowserTools } from "./tools.js";
import { loadSkills, formatSkillsForPrompt } from "./skills.js";
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

  const model = getModel("amazon-bedrock", (options.model || "anthropic.claude-sonnet-4-20250514-v1:0") as any);

  const agent = new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt(skills),
      model,
      thinkingLevel: "off",
      tools,
    },
  });

  agent.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
    if (event.type === "tool_execution_start") {
      process.stderr.write(`\n[tool] ${event.toolName}...\n`);
    }
    if (event.type === "agent_end") {
      process.stdout.write("\n");
    }
  });

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
      }

      prompt();
    });
  }

  // Handle Ctrl+C gracefully
  rl.on("close", async () => {
    try {
      await browser.close();
    } catch {
      // ignore close errors
    }
    process.exit(0);
  });

  prompt();
}
