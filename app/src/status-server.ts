import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface StatusUpdate {
  type: "turn_start" | "tool_start" | "tool_end" | "screenshot" | "error" | "alert" | "turn_end";
  timestamp: number;
  content: string;
  // Tool fields
  toolName?: string;
  toolLabel?: string;
  duration?: number;
  isError?: boolean;
  // Screenshot
  screenshot?: string;
  // Turn metadata
  tokens?: number;
  source?: string; // "repl" or daemon job id
  // Token usage (on turn_end)
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  contextWindow?: number;
  turnDuration?: number; // ms
}

const STATUS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>x-lens</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0c0e12;
    --bg-card: #13161c;
    --bg-card-hover: #181c24;
    --bg-tool: #0f1117;
    --border: #1e2330;
    --border-active: #2a3040;
    --text: #c8cdd8;
    --text-dim: #5c6370;
    --text-muted: #3e4452;
    --accent-amber: #e5a93d;
    --accent-amber-dim: rgba(229, 169, 61, 0.12);
    --accent-green: #59c98d;
    --accent-green-dim: rgba(89, 201, 141, 0.12);
    --accent-red: #e5534b;
    --accent-red-dim: rgba(229, 83, 75, 0.12);
    --accent-cyan: #56b6c2;
    --accent-cyan-dim: rgba(86, 182, 194, 0.12);
    --accent-purple: #c678dd;
    --accent-purple-dim: rgba(198, 120, 221, 0.12);
    --mono: "JetBrains Mono", "SF Mono", "Fira Code", monospace;
    --sans: "DM Sans", -apple-system, BlinkMacSystemFont, sans-serif;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--sans);
    font-size: 14px;
    line-height: 1.5;
    min-height: 100vh;
  }

  .header {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    padding: 16px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    backdrop-filter: blur(12px);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .logo {
    font-family: var(--mono);
    font-weight: 700;
    font-size: 16px;
    color: var(--accent-amber);
    letter-spacing: -0.5px;
  }

  .pulse {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-green);
    animation: pulse 2s ease-in-out infinite;
  }

  .pulse.idle {
    background: var(--text-dim);
    animation: none;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(89, 201, 141, 0.4); }
    50% { opacity: 0.7; box-shadow: 0 0 0 6px rgba(89, 201, 141, 0); }
  }

  .header-status {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-dim);
  }

  .stats {
    display: flex;
    gap: 16px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-dim);
  }

  .stat-value {
    color: var(--text);
    font-weight: 600;
  }

  .token-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 16px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-dim);
    border-top: 1px solid rgba(30, 35, 48, 0.5);
    background: rgba(13, 17, 23, 0.5);
  }

  .token-bar .token-item {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .token-bar .token-label {
    color: var(--text-muted);
    text-transform: uppercase;
    font-size: 9px;
    letter-spacing: 0.5px;
  }

  .token-bar .token-val {
    color: var(--text);
    font-weight: 500;
  }

  .token-bar .token-val.input { color: var(--accent-cyan); }
  .token-bar .token-val.output { color: var(--accent-amber); }
  .token-bar .token-val.cache { color: var(--accent-green); }

  .context-bar {
    height: 3px;
    background: var(--border);
    border-radius: 2px;
    flex: 1;
    max-width: 120px;
    overflow: hidden;
  }

  .context-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s;
  }

  .context-fill.low { background: var(--accent-green); }
  .context-fill.mid { background: var(--accent-amber); }
  .context-fill.high { background: var(--accent-red); }

  .feed {
    max-width: 900px;
    margin: 0 auto;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .turn-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    transition: border-color 0.2s;
  }

  .turn-card:first-child {
    border-color: var(--border-active);
  }

  .turn-card.has-alert {
    border-color: var(--accent-red);
    box-shadow: 0 0 20px rgba(229, 83, 75, 0.08);
  }

  .turn-header {
    padding: 12px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    user-select: none;
  }

  .turn-header:hover {
    background: var(--bg-card-hover);
  }

  .turn-header-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .turn-source {
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 8px;
    border-radius: 3px;
    background: var(--accent-amber-dim);
    color: var(--accent-amber);
  }

  .turn-source.daemon {
    background: var(--accent-purple-dim);
    color: var(--accent-purple);
  }

  .turn-label {
    font-weight: 600;
    font-size: 13px;
    color: var(--text);
  }

  .turn-meta {
    display: flex;
    align-items: center;
    gap: 12px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-dim);
  }

  .turn-token {
    color: var(--text-muted);
  }

  .turn-body {
    padding: 0;
  }

  .turn-body.collapsed {
    display: none;
  }

  .tool-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 16px;
    border-bottom: 1px solid rgba(30, 35, 48, 0.5);
    font-family: var(--mono);
    font-size: 12px;
    transition: background 0.15s;
  }

  .tool-row:hover {
    background: var(--bg-tool);
  }

  .tool-row:last-child {
    border-bottom: none;
  }

  .tool-icon {
    flex-shrink: 0;
    width: 18px;
    text-align: center;
    font-size: 13px;
    line-height: 20px;
  }

  .tool-content {
    flex: 1;
    min-width: 0;
  }

  .tool-label {
    color: var(--text);
    word-break: break-word;
  }

  .tool-label .tool-name {
    color: var(--accent-amber);
    font-weight: 500;
  }

  .tool-result {
    color: var(--text-dim);
    font-size: 11px;
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tool-duration {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: 11px;
    min-width: 50px;
    text-align: right;
  }

  .tool-row.error .tool-label { color: var(--accent-red); }
  .tool-row.error .tool-icon { color: var(--accent-red); }

  .tool-row.success .tool-icon { color: var(--accent-green); }

  .tool-row.running .tool-icon {
    color: var(--accent-amber);
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .tool-row.alert-row {
    background: var(--accent-red-dim);
    border-left: 3px solid var(--accent-red);
    padding-left: 13px;
  }

  .tool-row.alert-row .tool-label {
    color: var(--accent-red);
    font-weight: 600;
  }

  .screenshot-row {
    padding: 8px 16px;
    border-bottom: 1px solid rgba(30, 35, 48, 0.5);
  }

  .screenshot-toggle {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--accent-cyan);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    user-select: none;
  }

  .screenshot-toggle:hover {
    color: var(--text);
  }

  .screenshot-container {
    display: none;
    margin-top: 8px;
  }

  .screenshot-container.open {
    display: block;
  }

  .screenshot-container img {
    max-width: 100%;
    max-height: 350px;
    border-radius: 4px;
    border: 1px solid var(--border);
  }

  .empty-state {
    text-align: center;
    padding: 80px 24px;
    color: var(--text-dim);
  }

  .empty-state .empty-icon {
    font-size: 32px;
    margin-bottom: 12px;
    opacity: 0.3;
  }

  .empty-state p {
    font-size: 13px;
  }

  .chevron {
    transition: transform 0.2s;
    color: var(--text-muted);
    font-size: 12px;
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .tool-icon-map { display: none; }
</style>
</head>
<body>
<div class="header">
  <div class="header-left">
    <div class="logo">x-lens</div>
    <div class="pulse" id="pulse"></div>
    <span class="header-status" id="header-status">connecting...</span>
  </div>
  <div class="stats">
    <span>turns <span class="stat-value" id="stat-turns">0</span></span>
    <span>tools <span class="stat-value" id="stat-tools">0</span></span>
    <span>in <span class="stat-value" id="stat-input" style="color:var(--accent-cyan)">0</span></span>
    <span>out <span class="stat-value" id="stat-output" style="color:var(--accent-amber)">0</span></span>
    <span>cache <span class="stat-value" id="stat-cache" style="color:var(--accent-green)">0</span></span>
  </div>
</div>
<div class="feed" id="feed">
  <div class="empty-state">
    <div class="empty-icon">◇</div>
    <p>Waiting for agent activity...</p>
  </div>
</div>
<script>
const feed = document.getElementById("feed");
const pulse = document.getElementById("pulse");
const headerStatus = document.getElementById("header-status");
const statTurns = document.getElementById("stat-turns");
const statTools = document.getElementById("stat-tools");
const statInput = document.getElementById("stat-input");
const statOutput = document.getElementById("stat-output");
const statCache = document.getElementById("stat-cache");

const TOOL_ICONS = {
  browser_navigate: "→",
  browser_click: "◉",
  browser_type: "⌨",
  browser_scroll: "↕",
  browser_screenshot: "◻",
  browser_evaluate: "ƒ",
  web_search: "◎",
  shell: "$",
  fetch: "↗",
  memory_read: "◁",
  memory_write: "▷",
  memory_append: "▸",
  skill_read: "◈",
  schedule_create: "+",
  schedule_delete: "−",
  schedule_list: "≡",
};

function getToolIcon(toolName) {
  return TOOL_ICONS[toolName] || "·";
}

function escapeHtml(text) {
  const el = document.createElement("span");
  el.textContent = text;
  return el.innerHTML;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDuration(ms) {
  if (!ms) return "";
  if (ms < 1000) return ms + "ms";
  return (ms / 1000).toFixed(1) + "s";
}

function formatTokens(n) {
  if (!n) return "0";
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

function buildTurns(updates) {
  const turns = [];
  let current = null;

  for (const u of updates) {
    if (u.type === "turn_start") {
      current = {
        label: u.content, source: u.source || "repl", timestamp: u.timestamp,
        items: [], tokens: 0, hasAlert: false,
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        contextWindow: 0, turnDuration: 0,
      };
      turns.push(current);
    } else if (u.type === "turn_end" && current) {
      current.tokens = u.tokens || 0;
      current.inputTokens = u.inputTokens || 0;
      current.outputTokens = u.outputTokens || 0;
      current.cacheReadTokens = u.cacheReadTokens || 0;
      current.cacheWriteTokens = u.cacheWriteTokens || 0;
      current.contextWindow = u.contextWindow || 0;
      current.turnDuration = u.turnDuration || 0;
      current = null;
    } else if (current) {
      if (u.type === "alert") current.hasAlert = true;
      current.items.push(u);
    } else {
      // Orphan event — create implicit turn
      if (u.type === "tool_start" || u.type === "tool_end" || u.type === "alert" || u.type === "error") {
        current = { label: "Activity", source: u.source || "repl", timestamp: u.timestamp, items: [u], tokens: 0, hasAlert: u.type === "alert" };
        turns.push(current);
      }
    }
  }

  return turns;
}

function renderTurns(turns) {
  if (turns.length === 0) {
    feed.innerHTML = '<div class="empty-state"><div class="empty-icon">◇</div><p>Waiting for agent activity...</p></div>';
    statTurns.textContent = "0";
    statTools.textContent = "0";
    return;
  }

  let totalTools = 0;
  const reversed = turns.slice().reverse();

  feed.innerHTML = reversed.map((turn, idx) => {
    const isFirst = idx === 0;
    const sourceClass = turn.source === "repl" ? "" : " daemon";
    const alertClass = turn.hasAlert ? " has-alert" : "";
    const chevronClass = isFirst ? " open" : "";
    const bodyClass = isFirst ? "" : " collapsed";

    const itemsHtml = turn.items.map(item => {
      if (item.type === "tool_start") {
        totalTools++;
        return '<div class="tool-row running">' +
          '<div class="tool-icon">⟳</div>' +
          '<div class="tool-content"><div class="tool-label">' +
          escapeHtml(item.toolLabel || item.toolName || item.content) +
          '</div></div>' +
          '<div class="tool-duration">...</div></div>';
      }
      if (item.type === "tool_end") {
        totalTools++;
        const rowClass = item.isError ? "error" : "success";
        const icon = item.isError ? "✗" : "✓";
        const resultHtml = item.content ? '<div class="tool-result">' + escapeHtml(item.content) + '</div>' : "";
        return '<div class="tool-row ' + rowClass + '">' +
          '<div class="tool-icon">' + icon + '</div>' +
          '<div class="tool-content"><div class="tool-label">' +
          '<span class="tool-name">' + getToolIcon(item.toolName) + '</span> ' +
          escapeHtml(item.toolLabel || item.toolName || "") +
          '</div>' + resultHtml + '</div>' +
          '<div class="tool-duration">' + formatDuration(item.duration) + '</div></div>';
      }
      if (item.type === "screenshot") {
        return '<div class="screenshot-row">' +
          '<div class="screenshot-toggle" data-action="toggle-ss">' +
          '<span class="ss-chevron">▸</span> screenshot</div>' +
          '<div class="screenshot-container">' +
          '<img src="data:image/png;base64,' + item.screenshot + '" loading="lazy">' +
          '</div></div>';
      }
      if (item.type === "alert") {
        return '<div class="tool-row alert-row">' +
          '<div class="tool-icon">!</div>' +
          '<div class="tool-content"><div class="tool-label">' +
          escapeHtml(item.content) + '</div></div></div>';
      }
      if (item.type === "error") {
        return '<div class="tool-row error">' +
          '<div class="tool-icon">✗</div>' +
          '<div class="tool-content"><div class="tool-label">' +
          escapeHtml(item.content) + '</div></div></div>';
      }
      return "";
    }).join("");

    const turnId = "turn-" + idx;
    const durationStr = turn.turnDuration > 0 ? formatDuration(turn.turnDuration) : "";

    // Token bar for this turn
    let tokenBarHtml = "";
    if (turn.inputTokens > 0 || turn.outputTokens > 0) {
      const ctxPct = turn.contextWindow > 0 ? Math.min(100, Math.round((turn.inputTokens + turn.cacheReadTokens) / turn.contextWindow * 100)) : 0;
      const ctxClass = ctxPct > 80 ? "high" : ctxPct > 50 ? "mid" : "low";
      tokenBarHtml = '<div class="token-bar">' +
        '<div class="token-item"><span class="token-label">in</span> <span class="token-val input">' + formatTokens(turn.inputTokens) + '</span></div>' +
        '<div class="token-item"><span class="token-label">out</span> <span class="token-val output">' + formatTokens(turn.outputTokens) + '</span></div>' +
        (turn.cacheReadTokens > 0 ? '<div class="token-item"><span class="token-label">cache↓</span> <span class="token-val cache">' + formatTokens(turn.cacheReadTokens) + '</span></div>' : '') +
        (turn.cacheWriteTokens > 0 ? '<div class="token-item"><span class="token-label">cache↑</span> <span class="token-val">' + formatTokens(turn.cacheWriteTokens) + '</span></div>' : '') +
        (turn.contextWindow > 0 ? '<div class="token-item"><span class="token-label">ctx</span> <span class="token-val">' + ctxPct + '%</span></div>' +
          '<div class="context-bar"><div class="context-fill ' + ctxClass + '" style="width:' + ctxPct + '%"></div></div>' : '') +
        '</div>';
    }

    return '<div class="turn-card' + alertClass + '">' +
      '<div class="turn-header" data-action="toggle-turn">' +
      '<div class="turn-header-left">' +
      '<span class="chevron' + chevronClass + '">▸</span>' +
      '<span class="turn-source' + sourceClass + '">' + escapeHtml(turn.source) + '</span>' +
      '<span class="turn-label">' + escapeHtml(turn.label) + '</span>' +
      '</div>' +
      '<div class="turn-meta">' +
      (durationStr ? '<span>' + durationStr + '</span>' : '') +
      (turn.inputTokens > 0 ? '<span style="color:var(--accent-cyan)">' + formatTokens(turn.inputTokens) + ' in</span>' : '') +
      (turn.outputTokens > 0 ? '<span style="color:var(--accent-amber)">' + formatTokens(turn.outputTokens) + ' out</span>' : '') +
      '<span>' + formatTime(turn.timestamp) + '</span>' +
      '</div></div>' +
      '<div class="turn-body' + bodyClass + '">' +
      itemsHtml + tokenBarHtml + '</div></div>';
  }).join("");

  // Global stats
  let totalInput = 0, totalOutput = 0, totalCache = 0;
  for (const t of turns) {
    totalInput += t.inputTokens || 0;
    totalOutput += t.outputTokens || 0;
    totalCache += t.cacheReadTokens || 0;
  }
  statTurns.textContent = turns.length;
  statTools.textContent = totalTools;
  statInput.textContent = formatTokens(totalInput);
  statOutput.textContent = formatTokens(totalOutput);
  statCache.textContent = formatTokens(totalCache);
}

// Event delegation — handles all clicks
feed.addEventListener("click", function(e) {
  const target = e.target.closest("[data-action]");
  if (!target) return;

  const action = target.getAttribute("data-action");

  if (action === "toggle-turn") {
    const card = target.closest(".turn-card");
    if (!card) return;
    const body = card.querySelector(".turn-body");
    const chev = card.querySelector(".chevron");
    if (body) body.classList.toggle("collapsed");
    if (chev) chev.classList.toggle("open");
  }

  if (action === "toggle-ss") {
    const container = target.nextElementSibling;
    const chevron = target.querySelector(".ss-chevron");
    if (container) container.classList.toggle("open");
    if (chevron) chevron.textContent = container && container.classList.contains("open") ? "▾" : "▸";
  }
});

let lastLen = 0;
let lastDataLen = 0;

async function poll() {
  try {
    const res = await fetch("/api/updates");
    const data = await res.json();
    headerStatus.textContent = formatTime(Date.now());

    // Only re-render if data changed
    if (data.length !== lastDataLen) {
      lastDataLen = data.length;
      const turns = buildTurns(data);
      renderTurns(turns);
    }

    // Update pulse based on latest data
    const turns = buildTurns(data);
    const lastTurn = turns[turns.length - 1];
    const hasOpenTurn = lastTurn && !lastTurn.tokens;
    pulse.className = hasOpenTurn ? "pulse" : "pulse idle";

    lastLen = data.length;
  } catch (e) {
    headerStatus.textContent = "disconnected";
    pulse.className = "pulse idle";
  }
}

poll();
setInterval(poll, 1500);
</script>
</body>
</html>`;

export class StatusServer {
  private updates: StatusUpdate[] = [];
  private server: ReturnType<typeof createServer> | null = null;

  addUpdate(update: StatusUpdate): void {
    this.updates.push(update);
    if (this.updates.length > 500) this.updates.shift();
  }

  async start(port: number = 3456): Promise<void> {
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === "/api/updates") {
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify(this.updates));
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
          continue;
        }
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
