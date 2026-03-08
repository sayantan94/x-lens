import { exec } from "node:child_process";

/**
 * Send a macOS notification via osascript.
 */
export function notify(title: string, body: string, sound = "default"): void {
  const escapedTitle = title.replace(/"/g, '\\"');
  const escapedBody = body.replace(/"/g, '\\"');
  const cmd = `osascript -e 'display notification "${escapedBody}" with title "${escapedTitle}" sound name "${sound}"'`;
  exec(cmd, (err) => {
    if (err) {
      console.error(`Notification failed: ${err.message}`);
    }
  });
}
