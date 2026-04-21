#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config({ path: new URL("../../.env", import.meta.url).pathname });

import { Command } from "commander";

const program = new Command();

program
  .name("x-lens")
  .description("Skills-based personal agent with browser capabilities")
  .version("0.1.0")
  .enablePositionalOptions()
  .argument("[prompt]", "Task to execute (command mode)")
  .option("--visible", "Show browser window (default: headless)")
  .option("--model <model>", "Override model ID")
  .option(
    "--provider <provider>",
    "AI provider (bedrock or anthropic)",
    process.env.X_LENS_PROVIDER || "bedrock",
  )
  .option("--persona <persona>", "Persona to use (e.g., trader)")
  .option("--new", "Start a new session (clear conversation history)")
  .option("-p, --pipe", "Pipe mode: read prompt from stdin if no argument, output text only (no TUI). Works with: echo 'task' | x-lens -p")
  .action(async (prompt, options) => {
    // Pipe mode: read from stdin if no prompt given
    if (options.pipe && !prompt) {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      prompt = Buffer.concat(chunks).toString("utf-8").trim();
      if (!prompt) {
        console.error("Error: no input received on stdin");
        process.exit(1);
      }
    }

    if (prompt) {
      const { runOnce } = await import("./runner.js");
      await runOnce(prompt, { ...options, pipe: !!options.pipe });
    } else {
      const { runInteractive } = await import("./repl.js");
      await runInteractive(options);
    }
  });

// Dashboard subcommand
program
  .command("dashboard")
  .description("Start the Hive dashboard (control plane)")
  .option("--port <port>", "Port number (default: 3456)", "3456")
  .action(async (options) => {
    const { startDashboard } = await import("./dashboard.js");
    await startDashboard(parseInt(options.port, 10));
  });

// Daemon subcommand
const daemon = program.command("daemon").description("Manage the x-lens background daemon");

daemon
  .command("start")
  .description("Start the daemon in the background")
  .option("--provider <provider>", "AI provider (default: from env or bedrock)")
  .option("--model <model>", "Override model ID")
  .option("--persona <persona>", "Persona to run (default: trader)")
  .option("--foreground", "Run in foreground (don't daemonize)")
  .option("--telegram", "Enable Telegram bot for group messaging")
  .action(async (options) => {
    const { getDaemonPid } = await import("./daemon.js");
    const existingPid = getDaemonPid();
    if (existingPid) {
      console.log(`Daemon already running (PID: ${existingPid}). Use 'x-lens daemon stop' first.`);
      return;
    }

    if (options.foreground) {
      const { startDaemon } = await import("./daemon.js");
      await startDaemon(options);
      return;
    }

    // Spawn detached background process
    const { spawn } = await import("node:child_process");
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    const { existsSync, mkdirSync, openSync } = await import("node:fs");

    const logDir = join(homedir(), ".x-lens");
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, "daemon.log");
    const logFd = openSync(logPath, "a");

    const args = ["daemon", "start", "--foreground"];
    if (options.provider) args.push("--provider", options.provider);
    if (options.model) args.push("--model", options.model);
    if (options.persona) args.push("--persona", options.persona);
    if (options.telegram) args.push("--telegram");

    const child = spawn(process.execPath, [process.argv[1], ...args], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: process.env,
    });

    child.unref();
    console.log(`Daemon started (PID: ${child.pid}). Logs: ${logPath}`);
  });

daemon
  .command("stop")
  .description("Stop the running daemon")
  .action(async () => {
    const { stopDaemon } = await import("./daemon.js");
    const stopped = stopDaemon();
    if (stopped) {
      console.log("Daemon stopped.");
    } else {
      console.log("No daemon running.");
    }
  });

daemon
  .command("status")
  .description("Show daemon status and active jobs")
  .action(async () => {
    const { daemonStatus } = await import("./daemon.js");
    const status = daemonStatus();
    if (status.running) {
      console.log(`Daemon running (PID: ${status.pid})`);
    } else {
      console.log("Daemon not running.");
    }
    if (status.jobs.length === 0) {
      console.log("No scheduled jobs.");
    } else {
      console.log(`\nJobs (${status.jobs.length}):`);
      for (const job of status.jobs) {
        const schedule = job.type === "cron" ? job.schedule :
          job.type === "interval" ? `every ${job.interval_minutes}min` :
          `continuous (${job.pause_seconds}s pause)`;
        const lastRun = job.last_run ?? "never";
        const result = job.last_result_summary ? ` → ${job.last_result_summary.slice(0, 80)}` : "";
        console.log(`  ${job.enabled ? "●" : "○"} ${job.id} [${job.persona}] ${schedule} | last: ${lastRun}${result} | runs: ${job.run_count}`);
      }
    }
  });

daemon
  .command("install")
  .description("Install daemon as macOS launchd service (auto-start on boot)")
  .action(async () => {
    const { existsSync, writeFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    const { execSync } = await import("node:child_process");

    const launchAgentsDir = join(homedir(), "Library", "LaunchAgents");
    const plistPath = join(launchAgentsDir, "com.x-lens.daemon.plist");
    const logPath = join(homedir(), ".x-lens", "daemon.log");

    let binPath: string;
    try {
      binPath = execSync("which x-lens", { encoding: "utf-8" }).trim();
    } catch {
      console.error("x-lens not found in PATH. Run 'cd app && npm link' first.");
      process.exit(1);
    }

    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.x-lens.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>${binPath}</string>
        <string>daemon</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProcessType</key>
    <string>Background</string>
    <key>ExitTimeOut</key>
    <integer>25</integer>
    <key>AbandonProcessGroup</key>
    <false/>
    <key>StandardOutPath</key>
    <string>${logPath}</string>
    <key>StandardErrorPath</key>
    <string>${logPath}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>`;

    if (!existsSync(launchAgentsDir)) {
      mkdirSync(launchAgentsDir, { recursive: true });
    }

    writeFileSync(plistPath, plist, "utf-8");
    execSync(`launchctl load "${plistPath}"`);
    console.log(`Daemon installed at ${plistPath}`);
    console.log("It will start now and auto-restart on boot.");
  });

daemon
  .command("uninstall")
  .description("Remove daemon from launchd (stop auto-start)")
  .action(async () => {
    const { existsSync, unlinkSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    const { execSync } = await import("node:child_process");

    const plistPath = join(homedir(), "Library", "LaunchAgents", "com.x-lens.daemon.plist");
    if (!existsSync(plistPath)) {
      console.log("Daemon not installed.");
      return;
    }

    try { execSync(`launchctl unload "${plistPath}"`); } catch { /* ignore */ }
    unlinkSync(plistPath);
    console.log("Daemon uninstalled.");
  });

daemon
  .command("logs")
  .description("Tail daemon logs")
  .option("-n <lines>", "Number of lines to show", "50")
  .action(async (options) => {
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    const { spawn } = await import("node:child_process");

    const logPath = join(homedir(), ".x-lens", "daemon.log");
    const tail = spawn("tail", ["-f", "-n", options.n, logPath], { stdio: "inherit" });
    tail.on("error", () => {
      console.error("No daemon log found. Start the daemon first.");
    });
    tail.on("exit", (code) => process.exit(code ?? 0));
    // Forward Ctrl+C so the tail child doesn't outlive this CLI invocation.
    const killTail = () => { try { tail.kill(); } catch {} };
    process.on("SIGINT", killTail);
    process.on("SIGTERM", killTail);
    process.on("exit", killTail);
  });

program.parse();
