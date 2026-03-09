import { exec } from "node:child_process";

/**
 * Send a macOS notification via terminal-notifier.
 */
export function notify(title: string, body: string, subtitle?: string): void {
  const args = [
    "-title", JSON.stringify(title),
    "-message", JSON.stringify(body),
    "-group", "x-lens",
  ];
  if (subtitle) {
    args.push("-subtitle", JSON.stringify(subtitle));
  }
  const cmd = `terminal-notifier ${args.join(" ")}`;
  exec(cmd, (err) => {
    if (err) {
      console.error(`Notification failed: ${err.message}`);
    }
  });
}
