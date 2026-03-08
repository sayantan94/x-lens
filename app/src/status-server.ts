import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface StatusUpdate {
  type: "tool" | "message" | "screenshot" | "error";
  timestamp: number;
  content: string;
  screenshot?: string; // base64 PNG
}

const STATUS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>x-lens status</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #1a1a2e;
    color: #e0e0e0;
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 14px;
    padding: 16px;
  }
  h1 { color: #7f7fd5; margin-bottom: 12px; font-size: 18px; }
  .update {
    border-left: 3px solid #444;
    padding: 8px 12px;
    margin-bottom: 8px;
    background: #16213e;
    border-radius: 0 4px 4px 0;
  }
  .update.tool    { border-left-color: #f0c040; }
  .update.message { border-left-color: #4da6ff; }
  .update.error   { border-left-color: #ff4d4d; }
  .update.screenshot { border-left-color: #4dff88; }
  .ts { color: #888; font-size: 12px; margin-bottom: 4px; }
  .tag {
    display: inline-block;
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 3px;
    margin-right: 6px;
    font-weight: bold;
  }
  .tag.tool    { background: #f0c040; color: #1a1a2e; }
  .tag.message { background: #4da6ff; color: #1a1a2e; }
  .tag.error   { background: #ff4d4d; color: #fff; }
  .tag.screenshot { background: #4dff88; color: #1a1a2e; }
  .content { white-space: pre-wrap; word-break: break-word; margin-top: 4px; }
  .screenshot-img {
    max-width: 100%;
    max-height: 400px;
    margin-top: 8px;
    border: 1px solid #333;
    border-radius: 4px;
  }
  #status { color: #888; font-size: 12px; margin-bottom: 12px; }
</style>
</head>
<body>
<h1>x-lens status</h1>
<div id="status">connecting...</div>
<div id="updates"></div>
<script>
  const container = document.getElementById("updates");
  const statusEl = document.getElementById("status");
  let lastCount = 0;

  function render(updates) {
    const reversed = updates.slice().reverse();
    container.innerHTML = reversed.map(u => {
      const d = new Date(u.timestamp);
      const ts = d.toLocaleTimeString();
      let extra = "";
      if (u.screenshot) {
        extra = '<img class="screenshot-img" src="data:image/png;base64,' + u.screenshot + '">';
      }
      return '<div class="update ' + u.type + '">' +
        '<div class="ts">' + ts + '</div>' +
        '<span class="tag ' + u.type + '">' + u.type + '</span>' +
        '<div class="content">' + escapeHtml(u.content) + '</div>' +
        extra +
        '</div>';
    }).join("");
  }

  function escapeHtml(text) {
    const el = document.createElement("span");
    el.textContent = text;
    return el.innerHTML;
  }

  async function poll() {
    try {
      const res = await fetch("/api/updates");
      const data = await res.json();
      statusEl.textContent = "last poll: " + new Date().toLocaleTimeString() + " (" + data.length + " updates)";
      render(data);
    } catch (e) {
      statusEl.textContent = "error: " + e.message;
    }
  }

  poll();
  setInterval(poll, 2000);
</script>
</body>
</html>`;

export class StatusServer {
  private updates: StatusUpdate[] = [];
  private server: ReturnType<typeof createServer> | null = null;

  addUpdate(update: StatusUpdate): void {
    this.updates.push(update);
    if (this.updates.length > 200) this.updates.shift();
  }

  async start(port: number = 3456): Promise<void> {
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === "/api/updates") {
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify(this.updates.slice(-50)));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(STATUS_HTML);
    });

    const maxAttempts = 10;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const tryPort = port + attempt;
      try {
        await new Promise<void>((resolve, reject) => {
          this.server!.once("error", reject);
          this.server!.listen(tryPort, () => {
            this.server!.removeAllListeners("error");
            console.log(`Status page: http://localhost:${tryPort}`);
            resolve();
          });
        });
        return;
      } catch (err: any) {
        if (err.code === "EADDRINUSE" && attempt < maxAttempts - 1) {
          // Port busy, try next one
          continue;
        }
        // Give up silently — status page is optional
        this.server = null;
        return;
      }
    }
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
