/**
 * Hive Dashboard — brain state interface for x-lens.
 *
 * Single scrollable page, Palantir-style. Read-only.
 * Shows: current beliefs, accuracy, patterns, history.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  queryEvents,
  queryRuns,
  querySimulations,
  queryPatterns,
  getStats,
  getAccuracyByType,
  getPendingValidations,
  recordSimulation,
} from "./hive.js";

const X_LENS_DIR = join(homedir(), ".x-lens");
const SIMS_DIR = join(X_LENS_DIR, "simulations");

function syncSimulations(): void {
  if (!existsSync(SIMS_DIR)) return;
  const dirs = readdirSync(SIMS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const dir of dirs) {
    const simDir = join(SIMS_DIR, dir.name);
    const configPath = join(simDir, "simulation_config.json");
    if (!existsSync(configPath)) continue;
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      const profilesPath = join(simDir, "profiles.json");
      const agentCount = existsSync(profilesPath) ? JSON.parse(readFileSync(profilesPath, "utf-8")).length : 0;
      const actionsPath = join(simDir, "actions.jsonl");
      let actionCount = 0;
      if (existsSync(actionsPath)) {
        actionCount = readFileSync(actionsPath, "utf-8").trim().split("\n").filter((l) => l.trim()).length;
      }
      let reportSummary: string | undefined;
      const reportPath = join(simDir, "report.md");
      if (existsSync(reportPath)) {
        reportSummary = readFileSync(reportPath, "utf-8").slice(0, 2000);
      }
      recordSimulation({
        id: config.simulation_id || dir.name,
        scenario: config.scenario || dir.name,
        platform: "twitter",
        agent_count: agentCount,
        action_count: actionCount,
        sim_dir: simDir,
        report_summary: reportSummary,
      });
    } catch { /* skip */ }
  }
}

function jsonResponse(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

function handleApi(url: string, res: ServerResponse): boolean {
  if (url === "/api/events") { jsonResponse(res, queryEvents({ limit: 200 })); return true; }
  if (url === "/api/runs") { jsonResponse(res, queryRuns({ limit: 100 })); return true; }
  if (url === "/api/simulations") { syncSimulations(); jsonResponse(res, querySimulations(50)); return true; }
  if (url === "/api/patterns") { jsonResponse(res, queryPatterns()); return true; }
  if (url === "/api/stats") { jsonResponse(res, getStats()); return true; }
  if (url === "/api/pending") { jsonResponse(res, getPendingValidations()); return true; }
  if (url === "/api/accuracy-by-type") { jsonResponse(res, getAccuracyByType()); return true; }
  if (url?.startsWith("/api/simulation/")) {
    const simId = decodeURIComponent(url.slice("/api/simulation/".length));
    const sims = querySimulations(100);
    const sim = sims.find((s) => s.id === simId);
    if (!sim) { jsonResponse(res, { error: "not found" }, 404); return true; }
    const result: Record<string, unknown> = { ...sim };
    const reportPath = join(sim.sim_dir, "report.md");
    if (existsSync(reportPath)) result.report = readFileSync(reportPath, "utf-8");
    const actionsPath = join(sim.sim_dir, "actions.jsonl");
    if (existsSync(actionsPath)) {
      const lines = readFileSync(actionsPath, "utf-8").trim().split("\n").filter((l) => l.trim());
      result.actions = lines.slice(0, 500).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    }
    jsonResponse(res, result);
    return true;
  }
  return false;
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>x-lens hive</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    background: #1a1d21;
    color: #d4d7dc;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.5;
  }
  .topbar {
    background: #14161a;
    border-bottom: 1px solid #2a2d33;
    padding: 10px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .topbar-brand { font-size: 14px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: #fff; }
  .topbar-meta { font-size: 12px; color: #6b6f76; }
  .topbar-meta span { color: #8b8f96; }
  .container { padding: 20px 24px; max-width: 1100px; margin: 0 auto; }
  .metrics { display: flex; gap: 1px; background: #2a2d33; border: 1px solid #2a2d33; border-radius: 3px; overflow: hidden; margin-bottom: 20px; }
  .metric { background: #1e2126; flex: 1; padding: 14px 16px; }
  .metric-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #6b6f76; margin-bottom: 4px; }
  .metric-value { font-size: 22px; font-weight: 600; color: #fff; font-variant-numeric: tabular-nums; }
  .metric-sub { font-size: 11px; color: #6b6f76; }
  .section { margin-bottom: 24px; }
  .section-header { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #6b6f76; padding-bottom: 8px; border-bottom: 1px solid #2a2d33; margin-bottom: 1px; }
  .belief { padding: 12px 8px; border-bottom: 1px solid #22252a; }
  .belief:hover { background: #1e2126; }
  .belief-header { display: flex; gap: 8px; align-items: baseline; margin-bottom: 6px; font-size: 12px; color: #6b6f76; flex-wrap: wrap; }
  .belief-header .ticker { color: #fff; font-weight: 600; font-size: 13px; }
  .belief-header .conf { font-variant-numeric: tabular-nums; color: #8b8f96; }
  .belief-body { color: #d4d7dc; font-size: 13px; line-height: 1.6; }
  .score-strip { display: flex; gap: 24px; padding: 10px 8px; font-size: 12px; color: #6b6f76; flex-wrap: wrap; }
  .score-val { color: #8b8f96; font-weight: 500; }
  .pattern-row { display: grid; grid-template-columns: 70px 1fr 80px; padding: 7px 8px; border-bottom: 1px solid #22252a; font-size: 13px; align-items: baseline; }
  .pattern-row:hover { background: #1e2126; }
  .col-rate { font-variant-numeric: tabular-nums; font-weight: 500; }
  .rate-good { color: #52a86c; }
  .rate-mid { color: #c49a3c; }
  .rate-bad { color: #c45250; }
  .col-cat { color: #6b6f76; text-align: right; font-size: 12px; }
  .hist-row { display: grid; grid-template-columns: 60px 90px 50px 1fr 70px; padding: 6px 8px; border-bottom: 1px solid #22252a; font-size: 12px; align-items: baseline; }
  .hist-row:hover { background: #1e2126; }
  .col-date { color: #6b6f76; font-variant-numeric: tabular-nums; }
  .col-type { color: #8b8f96; font-size: 12px; }
  .col-ticker { color: #fff; font-weight: 500; }
  .col-summary { color: #d4d7dc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .col-outcome { text-align: right; font-size: 11px; }
  .outcome-correct { color: #52a86c; }
  .outcome-incorrect { color: #c45250; }
  .outcome-partial { color: #c49a3c; }
  .outcome-pending { color: #4a4d54; }
  .footer { text-align: center; padding: 16px 0; margin-top: 12px; border-top: 1px solid #2a2d33; font-size: 11px; color: #4a4d54; }
  .empty { padding: 20px 8px; color: #4a4d54; }
  @media(max-width:700px) { .metrics { flex-direction: column; } .hist-row { grid-template-columns: 50px 70px 40px 1fr 60px; font-size: 11px; } }
</style>
</head>
<body>
<div class="topbar">
  <div class="topbar-brand">x-lens hive</div>
  <div class="topbar-meta" id="topbar-meta">loading...</div>
</div>
<div class="container">
  <div class="metrics" id="metrics"></div>
  <div id="beliefs" class="section"></div>
  <div id="accuracy" class="section"></div>
  <div id="patterns" class="section"></div>
  <div id="history" class="section"></div>
</div>
<div class="footer" id="footer"></div>
<script>
function esc(s) { if (!s) return ""; var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function ago(iso) {
  if (!iso) return "";
  var ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return "now";
  if (ms < 3600000) return Math.floor(ms/60000) + "m ago";
  if (ms < 86400000) return Math.floor(ms/3600000) + "h ago";
  return Math.floor(ms/86400000) + "d ago";
}
function shortDate(d) {
  if (!d) return "";
  var parts = d.split("-");
  var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return months[parseInt(parts[1],10)-1] + " " + parseInt(parts[2],10);
}
function outcomeClass(o) {
  if (!o) return "outcome-pending";
  if (o === "correct") return "outcome-correct";
  if (o === "incorrect") return "outcome-incorrect";
  return "outcome-partial";
}
function rateClass(r) {
  if (r === null || r === undefined) return "";
  if (r >= 0.7) return "rate-good";
  if (r >= 0.5) return "rate-mid";
  return "rate-bad";
}

function load() {
  return Promise.all([
    fetch("/api/stats").then(function(r){return r.json();}),
    fetch("/api/events").then(function(r){return r.json();}),
    fetch("/api/accuracy-by-type").then(function(r){return r.json();}),
    fetch("/api/patterns").then(function(r){return r.json();}),
    fetch("/api/runs").then(function(r){return r.json();}),
  ]);
}

function render(data) {
  var stats = data[0], events = data[1], accTypes = data[2], patterns = data[3], runs = data[4];

  // Top bar
  var lastRun = runs.length > 0 ? ago(runs[0].started_at) : "never";
  var persona = runs.length > 0 && runs[0].persona ? runs[0].persona : "";
  document.getElementById("topbar-meta").innerHTML = "last run <span>" + esc(lastRun) + "</span>" + (persona ? " \\xb7 " + esc(persona) : "");

  // Metrics
  var acc = stats.validated > 0 ? Math.round((stats.byOutcome.correct || 0) / stats.validated * 100) : 0;
  var accLabel = stats.validated > 0 ? acc + "%" : "\\u2014";
  document.getElementById("metrics").innerHTML =
    '<div class="metric"><div class="metric-label">Accuracy</div><div class="metric-value">' + accLabel + '</div><div class="metric-sub">' + (stats.validated || 0) + ' of ' + (stats.totalEvents || 0) + ' validated</div></div>' +
    '<div class="metric"><div class="metric-label">Events</div><div class="metric-value">' + (stats.totalEvents || 0) + '</div><div class="metric-sub">' + (stats.dateRange.earliest && stats.dateRange.latest ? shortDate(stats.dateRange.earliest) + ' \\u2013 ' + shortDate(stats.dateRange.latest) : 'no data') + '</div></div>' +
    '<div class="metric"><div class="metric-label">Pending</div><div class="metric-value">' + (stats.pending || 0) + '</div><div class="metric-sub">awaiting validation</div></div>' +
    '<div class="metric"><div class="metric-label">Patterns</div><div class="metric-value">' + (stats.patternCount || 0) + '</div><div class="metric-sub">learned</div></div>';

  // Beliefs — unvalidated events sorted by confidence desc
  var beliefs = events.filter(function(e) { return !e.validated; }).sort(function(a, b) {
    var ca = a.confidence != null ? a.confidence : 0;
    var cb = b.confidence != null ? b.confidence : 0;
    if (cb !== ca) return cb - ca;
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  });
  var bhtml = '<div class="section-header">Current Beliefs</div>';
  if (beliefs.length === 0) {
    bhtml += '<div class="empty">No active beliefs. Run the agent to start recording.</div>';
  } else {
    for (var i = 0; i < beliefs.length; i++) {
      var b = beliefs[i];
      var conf = b.confidence != null ? Math.round(b.confidence * 100) + "%" : "";
      var parts = [esc(b.type)];
      if (b.ticker) parts.push('<span class="ticker">' + esc(b.ticker) + '</span>');
      if (conf) parts.push('<span class="conf">' + conf + '</span>');
      parts.push("\\xb7");
      parts.push(ago(b.created_at));
      if (b.category) { parts.push("\\xb7"); parts.push(esc(b.category)); }
      if (b.source_skill) { parts.push("\\xb7"); parts.push(esc(b.source_skill)); }
      bhtml += '<div class="belief"><div class="belief-header">' + parts.join(" ") + '</div><div class="belief-body">' + esc(b.summary) + '</div></div>';
    }
  }
  document.getElementById("beliefs").innerHTML = bhtml;

  // Accuracy by type
  var ahtml = '<div class="section-header">Accuracy by Type</div><div class="score-strip">';
  if (accTypes.length === 0) {
    ahtml += '<span>no data</span>';
  } else {
    for (var j = 0; j < accTypes.length; j++) {
      var t = accTypes[j];
      var wr = t.win_rate != null ? Math.round(t.win_rate * 100) + "%" : "\\u2014";
      ahtml += '<span>' + esc(t.type) + ' <span class="score-val">' + wr + '</span> n=' + t.total + '</span>';
    }
  }
  ahtml += '</div>';
  document.getElementById("accuracy").innerHTML = ahtml;

  // Patterns
  var phtml = '<div class="section-header">Patterns</div>';
  if (patterns.length === 0) {
    phtml += '<div class="empty">No patterns learned yet.</div>';
  } else {
    for (var k = 0; k < patterns.length; k++) {
      var p = patterns[k];
      var pwr = p.win_rate != null ? Math.round(p.win_rate * 100) + "%" : "\\u2014";
      var rc = rateClass(p.win_rate);
      phtml += '<div class="pattern-row"><div class="col-rate ' + rc + '">' + pwr + ' (' + (p.sample_size || 0) + ')</div><div>' + esc(p.name || p.description) + '</div><div class="col-cat">' + esc(p.category) + '</div></div>';
    }
  }
  document.getElementById("patterns").innerHTML = phtml;

  // History — all events
  var hhtml = '<div class="section-header">History</div>';
  if (events.length === 0) {
    hhtml += '<div class="empty">No events.</div>';
  } else {
    for (var m = 0; m < events.length; m++) {
      var e = events[m];
      var oc = e.validated ? (e.outcome || "unknown") : "pending";
      var ocClass = outcomeClass(e.validated ? e.outcome : null);
      var sum = e.summary || "";
      hhtml += '<div class="hist-row"><div class="col-date">' + shortDate(e.date) + '</div><div class="col-type">' + esc(e.type) + '</div><div class="col-ticker">' + esc(e.ticker || "") + '</div><div class="col-summary">' + esc(sum) + '</div><div class="col-outcome ' + ocClass + '">' + esc(oc) + '</div></div>';
    }
  }
  document.getElementById("history").innerHTML = hhtml;

  // Footer
  document.getElementById("footer").textContent = (stats.totalEvents || 0) + " events \\xb7 " + (stats.validated || 0) + " validated \\xb7 " + (stats.patternCount || 0) + " patterns";
}

load().then(render).catch(function() {
  document.getElementById("beliefs").innerHTML = '<div class="empty">Failed to load data.</div>';
});
setInterval(function() { load().then(render); }, 30000);
</script>
</body>
</html>`;

export async function startDashboard(port = 3456): Promise<void> {
  syncSimulations();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || "/";
    if (handleApi(url, res)) return;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(DASHBOARD_HTML);
  });

  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const tryPort = port + attempt;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(tryPort, () => {
          server.removeAllListeners("error");
          console.log(`Hive dashboard: http://localhost:${tryPort}`);
          resolve();
        });
      });
      await new Promise(() => {});
    } catch (err: any) {
      if (err.code === "EADDRINUSE" && attempt < maxAttempts - 1) continue;
      console.error(`Failed to start dashboard: ${err.message}`);
      process.exit(1);
    }
  }
}
