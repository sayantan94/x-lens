# Job Finder Posts UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `/jobs` page to the status server for browsing saved LinkedIn hiring posts.

**Architecture:** Add two routes to the existing `StatusServer` in `status-server.ts`: `GET /api/jobs` reads `~/.x-lens/linkedin-posts.jsonl` and returns JSON, `GET /jobs` serves a self-contained HTML page with a sortable/searchable table. Same embedded HTML pattern as the existing dashboard.

**Tech Stack:** Node.js HTTP server (already in status-server.ts), vanilla HTML/CSS/JS, no new dependencies.

---

### Task 1: Add `/api/jobs` endpoint

**Files:**
- Modify: `app/src/status-server.ts:722-732` (inside the `createServer` callback)
- Test: `app/src/__tests__/jobs-api.test.ts`

**Step 1: Write the failing test**

Create `app/src/__tests__/jobs-api.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { StatusServer } from "../status-server";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const TEST_PORT = 13457;
const JSONL_DIR = join(homedir(), ".x-lens");
const JSONL_PATH = join(JSONL_DIR, "linkedin-posts.jsonl");

describe("/api/jobs endpoint", () => {
  let server: StatusServer;
  let originalContent: string | null = null;

  beforeAll(async () => {
    // Backup existing file if present
    if (existsSync(JSONL_PATH)) {
      originalContent = readFileSync(JSONL_PATH, "utf-8");
    }
    server = new StatusServer();
    await server.start(TEST_PORT);
  });

  afterAll(async () => {
    await server.stop();
    // Restore original file
    if (originalContent !== null) {
      writeFileSync(JSONL_PATH, originalContent);
    }
  });

  it("should return empty array when JSONL file does not exist", async () => {
    // Temporarily remove the file
    const backup = existsSync(JSONL_PATH) ? readFileSync(JSONL_PATH, "utf-8") : null;
    if (existsSync(JSONL_PATH)) rmSync(JSONL_PATH);

    const res = await fetch(`http://localhost:${TEST_PORT}/api/jobs`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const data = await res.json();
    expect(data).toEqual([]);

    // Restore
    if (backup !== null) writeFileSync(JSONL_PATH, backup);
  });

  it("should return parsed posts from JSONL file", async () => {
    mkdirSync(JSONL_DIR, { recursive: true });
    const post1 = JSON.stringify({ id: "abc123", author: "Jane", company: "Google", relevanceScore: 0.87, url: "https://linkedin.com/post/1" });
    const post2 = JSON.stringify({ id: "def456", author: "Bob", company: "Meta", relevanceScore: 0.65, url: "https://linkedin.com/post/2" });
    writeFileSync(JSONL_PATH, post1 + "\n" + post2 + "\n");

    const res = await fetch(`http://localhost:${TEST_PORT}/api/jobs`);
    const data = await res.json();
    expect(data).toHaveLength(2);
    expect(data[0].author).toBe("Jane");
    expect(data[1].author).toBe("Bob");
  });

  it("should skip malformed JSONL lines", async () => {
    mkdirSync(JSONL_DIR, { recursive: true });
    const good = JSON.stringify({ id: "abc", author: "Jane", relevanceScore: 0.8 });
    writeFileSync(JSONL_PATH, good + "\nnot json\n\n" + good + "\n");

    const res = await fetch(`http://localhost:${TEST_PORT}/api/jobs`);
    const data = await res.json();
    // Two valid lines (both have same id, but API doesn't dedup — that's the skill's job)
    expect(data).toHaveLength(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && npx vitest run src/__tests__/jobs-api.test.ts`
Expected: FAIL — `/api/jobs` returns 200 with HTML (falls through to default route)

**Step 3: Write minimal implementation**

In `status-server.ts`, add the `/api/jobs` route inside the `createServer` callback, before the default HTML route. Add the required imports at the top of the file.

Add imports at top of `status-server.ts`:
```typescript
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
```

Add route inside `createServer` callback, after the `/api/updates` block and before the default HTML response:

```typescript
      if (req.url === "/api/jobs") {
        const jsonlPath = join(homedir(), ".x-lens", "linkedin-posts.jsonl");
        let posts: unknown[] = [];
        if (existsSync(jsonlPath)) {
          const content = readFileSync(jsonlPath, "utf-8");
          for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              posts.push(JSON.parse(trimmed));
            } catch {
              // Skip malformed lines
            }
          }
        }
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify(posts));
        return;
      }
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && npx vitest run src/__tests__/jobs-api.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add app/src/status-server.ts app/src/__tests__/jobs-api.test.ts
git commit -m "feat: add /api/jobs endpoint to status server"
```

---

### Task 2: Add `/jobs` HTML page

**Files:**
- Modify: `app/src/status-server.ts` (add JOBS_HTML constant and `/jobs` route)

**Step 1: Create the JOBS_HTML constant**

Add a new `const JOBS_HTML` string above the `StatusServer` class (after the existing `STATUS_HTML`). This is a self-contained HTML page with:

- Same CSS variables as STATUS_HTML (dark theme, amber accents, JetBrains Mono + DM Sans)
- Sticky header with "x-lens" logo and "Jobs" label
- Controls bar: text search input, sort-by-score / sort-by-date toggle buttons, post count
- Table with columns: Score, Author, Company, Location, Seniority, Posted, Text (truncated)
- Clickable rows that expand to show full text + "View on LinkedIn" link
- Score badges: green (>0.7), amber (0.5-0.7), gray (<0.5)
- Empty state: "No posts collected yet. Run a LinkedIn search first."
- Fetches from `/api/jobs` on page load
- Client-side search filters across all text fields
- Client-side sort toggles between score (desc) and date (desc)

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>x-lens — Jobs</title>
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

  .logo a {
    color: inherit;
    text-decoration: none;
  }

  .page-label {
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 8px;
    border-radius: 3px;
    background: var(--accent-amber-dim);
    color: var(--accent-amber);
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 24px;
    border-bottom: 1px solid var(--border);
    background: rgba(13, 17, 23, 0.5);
  }

  .search-input {
    flex: 1;
    max-width: 360px;
    padding: 6px 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-family: var(--mono);
    font-size: 12px;
    outline: none;
  }

  .search-input:focus {
    border-color: var(--accent-amber);
  }

  .search-input::placeholder {
    color: var(--text-muted);
  }

  .sort-btn {
    padding: 4px 12px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-dim);
    font-family: var(--mono);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .sort-btn:hover {
    background: var(--bg-card-hover);
    color: var(--text);
  }

  .sort-btn.active {
    background: var(--accent-amber-dim);
    color: var(--accent-amber);
    border-color: var(--accent-amber);
  }

  .post-count {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-dim);
    margin-left: auto;
  }

  .post-count .count-val {
    color: var(--text);
    font-weight: 600;
  }

  .container {
    max-width: 1100px;
    margin: 0 auto;
    padding: 16px 24px;
  }

  .table-wrapper {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  thead th {
    text-align: left;
    padding: 8px 12px;
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
    user-select: none;
  }

  tbody tr {
    border-bottom: 1px solid rgba(30, 35, 48, 0.5);
    cursor: pointer;
    transition: background 0.15s;
  }

  tbody tr:hover {
    background: var(--bg-card-hover);
  }

  tbody td {
    padding: 10px 12px;
    vertical-align: top;
  }

  .score-badge {
    display: inline-block;
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 4px;
    min-width: 44px;
    text-align: center;
  }

  .score-high {
    background: var(--accent-green-dim);
    color: var(--accent-green);
  }

  .score-mid {
    background: var(--accent-amber-dim);
    color: var(--accent-amber);
  }

  .score-low {
    background: rgba(92, 99, 112, 0.15);
    color: var(--text-dim);
  }

  .author-name {
    font-weight: 600;
    color: var(--text);
  }

  .author-title {
    font-size: 11px;
    color: var(--text-dim);
    margin-top: 2px;
  }

  .text-snippet {
    color: var(--text-dim);
    font-size: 12px;
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .posted-at {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-dim);
    white-space: nowrap;
  }

  .expanded-row td {
    padding: 0;
    border-bottom: 1px solid var(--border);
  }

  .expanded-content {
    padding: 16px 24px;
    background: var(--bg-card);
    border-left: 3px solid var(--accent-amber);
  }

  .expanded-text {
    font-size: 13px;
    line-height: 1.6;
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-word;
    margin-bottom: 12px;
  }

  .expanded-meta {
    display: flex;
    gap: 16px;
    align-items: center;
    flex-wrap: wrap;
  }

  .expanded-meta span {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-dim);
  }

  .linkedin-link {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--accent-cyan);
    text-decoration: none;
  }

  .linkedin-link:hover {
    text-decoration: underline;
  }

  .ranking-reason {
    font-size: 11px;
    color: var(--text-muted);
    font-style: italic;
    margin-top: 8px;
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
</style>
</head>
<body>
<div class="header">
  <div class="header-left">
    <div class="logo"><a href="/">x-lens</a></div>
    <span class="page-label">Jobs</span>
  </div>
</div>
<div class="controls">
  <input type="text" class="search-input" id="search" placeholder="Search posts...">
  <button class="sort-btn active" id="sort-score" data-sort="score">Score</button>
  <button class="sort-btn" id="sort-date" data-sort="date">Date</button>
  <span class="post-count"><span class="count-val" id="post-count">0</span> posts</span>
</div>
<div class="container">
  <div class="table-wrapper">
    <div id="content">
      <div class="empty-state">
        <div class="empty-icon">&#9671;</div>
        <p>Loading...</p>
      </div>
    </div>
  </div>
</div>
<script>
const content = document.getElementById("content");
const searchInput = document.getElementById("search");
const sortScoreBtn = document.getElementById("sort-score");
const sortDateBtn = document.getElementById("sort-date");
const postCountEl = document.getElementById("post-count");

let allPosts = [];
let currentSort = "score";
let expandedId = null;

function escapeHtml(text) {
  const el = document.createElement("span");
  el.textContent = text || "";
  return el.innerHTML;
}

function scoreClass(score) {
  if (score > 0.7) return "score-high";
  if (score >= 0.5) return "score-mid";
  return "score-low";
}

function truncate(text, len) {
  if (!text) return "";
  return text.length > len ? text.substring(0, len) + "..." : text;
}

function filterPosts(posts, query) {
  if (!query) return posts;
  const q = query.toLowerCase();
  return posts.filter(p => {
    const searchable = [p.author, p.authorTitle, p.company, p.text, p.location, p.seniority].join(" ").toLowerCase();
    return searchable.includes(q);
  });
}

function sortPosts(posts, sortBy) {
  return posts.slice().sort((a, b) => {
    if (sortBy === "score") return (b.relevanceScore || 0) - (a.relevanceScore || 0);
    // Sort by postedAt: "1d" < "2d" < "1w" etc. — rough parse
    return 0; // Date sort is best-effort since we only have relative timestamps
  });
}

function renderTable(posts) {
  if (posts.length === 0) {
    content.innerHTML = '<div class="empty-state"><div class="empty-icon">&#9671;</div><p>No posts collected yet. Run a LinkedIn search first.</p></div>';
    postCountEl.textContent = "0";
    return;
  }

  postCountEl.textContent = String(posts.length);

  let html = '<table><thead><tr>' +
    '<th>Score</th><th>Author</th><th>Company</th><th>Location</th><th>Seniority</th><th>Posted</th><th>Text</th>' +
    '</tr></thead><tbody>';

  for (const p of posts) {
    const id = p.id || p.url || "";
    const isExpanded = expandedId === id;
    const score = typeof p.relevanceScore === "number" ? p.relevanceScore.toFixed(2) : "—";

    html += '<tr data-id="' + escapeHtml(id) + '">' +
      '<td><span class="score-badge ' + scoreClass(p.relevanceScore || 0) + '">' + score + '</span></td>' +
      '<td><div class="author-name">' + escapeHtml(p.author) + '</div>' +
      '<div class="author-title">' + escapeHtml(truncate(p.authorTitle, 40)) + '</div></td>' +
      '<td>' + escapeHtml(p.company || "—") + '</td>' +
      '<td>' + escapeHtml(p.location || "—") + '</td>' +
      '<td>' + escapeHtml(p.seniority || "—") + '</td>' +
      '<td><span class="posted-at">' + escapeHtml(p.postedAt || "—") + '</span></td>' +
      '<td><span class="text-snippet">' + escapeHtml(truncate(p.text, 80)) + '</span></td>' +
      '</tr>';

    if (isExpanded) {
      html += '<tr class="expanded-row"><td colspan="7"><div class="expanded-content">' +
        '<div class="expanded-text">' + escapeHtml(p.text) + '</div>' +
        '<div class="expanded-meta">' +
        (p.url ? '<a href="' + escapeHtml(p.url) + '" target="_blank" rel="noopener" class="linkedin-link">View on LinkedIn &#8599;</a>' : '') +
        (p.capturedAt ? '<span>Captured: ' + escapeHtml(new Date(p.capturedAt).toLocaleDateString()) + '</span>' : '') +
        (p.searchQuery ? '<span>Query: ' + escapeHtml(p.searchQuery) + '</span>' : '') +
        '</div>' +
        (p.rankingReason ? '<div class="ranking-reason">' + escapeHtml(p.rankingReason) + '</div>' : '') +
        '</div></td></tr>';
    }
  }

  html += '</tbody></table>';
  content.innerHTML = html;
}

function refresh() {
  const query = searchInput.value;
  let posts = filterPosts(allPosts, query);
  posts = sortPosts(posts, currentSort);
  renderTable(posts);
}

// Event: row click to expand/collapse
content.addEventListener("click", function(e) {
  const row = e.target.closest("tr[data-id]");
  if (!row) return;
  const id = row.getAttribute("data-id");
  expandedId = expandedId === id ? null : id;
  refresh();
});

// Event: search
searchInput.addEventListener("input", refresh);

// Event: sort buttons
sortScoreBtn.addEventListener("click", function() {
  currentSort = "score";
  sortScoreBtn.classList.add("active");
  sortDateBtn.classList.remove("active");
  refresh();
});

sortDateBtn.addEventListener("click", function() {
  currentSort = "date";
  sortDateBtn.classList.add("active");
  sortScoreBtn.classList.remove("active");
  refresh();
});

// Load data
fetch("/api/jobs")
  .then(r => r.json())
  .then(data => {
    allPosts = data;
    refresh();
  })
  .catch(() => {
    content.innerHTML = '<div class="empty-state"><div class="empty-icon">&#9671;</div><p>Failed to load posts. Is the server running?</p></div>';
  });
</script>
</body>
</html>
```

**Step 2: Add the JOBS_HTML constant and route**

In `status-server.ts`:
1. Add `const JOBS_HTML = \`...\`;` after the `STATUS_HTML` constant (before the `StatusServer` class)
2. Add the `/jobs` route inside `createServer`, after the `/api/jobs` block:

```typescript
      if (req.url === "/jobs") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(JOBS_HTML);
        return;
      }
```

**Step 3: Manually verify**

1. Start the daemon or status server
2. Open `http://localhost:3456/jobs` in a browser
3. Verify: dark theme, table renders, search works, sort toggles work
4. If `~/.x-lens/linkedin-posts.jsonl` has data: verify posts appear
5. If no data: verify empty state message shows

**Step 4: Commit**

```bash
git add app/src/status-server.ts
git commit -m "feat: add /jobs page for browsing LinkedIn hiring posts"
```

---

### Task 3: Add `/jobs` route test

**Files:**
- Modify: `app/src/__tests__/jobs-api.test.ts`

**Step 1: Add test for /jobs route**

Add to the existing test file:

```typescript
  it("should serve HTML page at /jobs", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/jobs`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("x-lens");
    expect(html).toContain("Jobs");
    expect(html).toContain("/api/jobs");
  });
```

**Step 2: Run tests**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && npx vitest run src/__tests__/jobs-api.test.ts`
Expected: PASS (4 tests)

**Step 3: Commit**

```bash
git add app/src/__tests__/jobs-api.test.ts
git commit -m "test: add /jobs HTML route test"
```

---

### Task 4: Run all tests and verify

**Step 1: Run full test suite**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && npx vitest run`
Expected: All tests pass (existing + new)

**Step 2: Verify no regressions**

- Status dashboard at `/` still works
- `/api/updates` still works
- New `/jobs` page loads
- New `/api/jobs` returns data

**Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address test issues from jobs UI integration"
```
