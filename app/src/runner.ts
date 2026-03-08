import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { BrowserController } from "./browser.js";
import { createBrowserTools } from "./tools.js";
import { loadSkills, formatSkillsForPrompt } from "./skills.js";
import { StatusServer } from "./status-server.js";
import { join } from "node:path";

export interface RunOptions {
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

export async function runOnce(prompt: string, options: RunOptions = {}): Promise<void> {
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

  try {
    await status.start();
    await agent.prompt(prompt);
    await agent.waitForIdle();

    if (agent.state.error) {
      process.stderr.write(`\n[error] ${agent.state.error}\n`);
      status.addUpdate({
        type: "error",
        timestamp: Date.now(),
        content: String(agent.state.error),
      });
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    await status.stop();
  }
}
