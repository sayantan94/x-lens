#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("x-lens")
  .description("Skills-based personal agent with browser capabilities")
  .version("0.1.0")
  .argument("[prompt]", "Task to execute (command mode)")
  .option("--visible", "Show browser window (default: headless)")
  .option("--model <model>", "Override model (default: bedrock claude)")
  .action(async (prompt, options) => {
    if (prompt) {
      const { runOnce } = await import("./runner.js");
      await runOnce(prompt, options);
    } else {
      const { runInteractive } = await import("./repl.js");
      await runInteractive(options);
    }
  });

program.parse();
