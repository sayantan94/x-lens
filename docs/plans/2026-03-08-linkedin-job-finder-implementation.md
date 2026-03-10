# LinkedIn Job-Finder Persona Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `job-finder` persona that searches LinkedIn for hiring posts, analyzes and ranks them, and saves results to a JSONL file.

**Architecture:** New `skills/job-finder/` directory with 4 skills teaching the agent LinkedIn-specific workflows. Generalize the daemon system prompt so it's not hardcoded to trader. Add per-persona browser profile directories. No new tools — everything uses existing browser, shell, and memory tools.

**Tech Stack:** TypeScript, Playwright (existing), JSONL file storage, existing skill/persona system

---

### Task 1: Create the `linkedin-search` skill

**Files:**
- Create: `skills/job-finder/linkedin-search/skill.md`

**Step 1: Create the skill directory and file**

```markdown
---
name: linkedin-search
description: Decompose natural language job search prompts into LinkedIn content search queries and execute them
triggers: [linkedin, job search, hiring posts, linkedin search, find posts, job posts]
---

## Instructions

You are a LinkedIn search specialist. Your job is to take a natural language job search request and turn it into effective LinkedIn content searches.

### Query Decomposition

When given a prompt like "find posts about hiring senior+ backend engineers at FAANG in Seattle", decompose it into multiple search queries:

1. **By company**: "hiring senior engineer Amazon Seattle", "Google Seattle engineering team", "Meta hiring backend Seattle"
2. **By role keywords**: "senior backend engineer hiring Seattle", "staff engineer opening Seattle"
3. **By hashtag/keyword patterns**: "we're hiring senior engineer", "join my team backend", "open role engineering Seattle"

Generate 5-10 search queries that cover different angles. More specific queries yield better results than broad ones.

### Executing Searches

For each query:

1. Navigate to: `https://www.linkedin.com/search/results/content/?keywords=<encoded_query>&sortBy=date_posted`
2. Wait for results to load (take a screenshot to verify)
3. Scroll down 3-5 times to load more results (use `browser_scroll` with direction "down", amount 800)
4. After scrolling, extract post data using `browser_evaluate`

### Extracting Posts

Use `browser_evaluate` with this JavaScript to extract visible posts:

```js
(() => {
  const posts = [];
  document.querySelectorAll('.feed-shared-update-v2').forEach(el => {
    const authorEl = el.querySelector('.update-components-actor__name .visually-hidden');
    const titleEl = el.querySelector('.update-components-actor__description .visually-hidden');
    const textEl = el.querySelector('.feed-shared-update-v2__description .break-words');
    const timeEl = el.querySelector('.update-components-actor__sub-description .visually-hidden');
    const linkEl = el.querySelector('a.app-aware-link[href*="/feed/update/"]');

    if (textEl) {
      posts.push({
        author: authorEl?.textContent?.trim() || '',
        authorTitle: titleEl?.textContent?.trim() || '',
        text: textEl.textContent?.trim() || '',
        postedAt: timeEl?.textContent?.trim() || '',
        url: linkEl?.href || '',
      });
    }
  });
  return JSON.stringify(posts);
})()
```

**Important**: LinkedIn's DOM changes frequently. If the selectors above don't work:
1. Take a screenshot to see the current layout
2. Use `browser_evaluate` to inspect the DOM: `document.querySelector('.feed-shared-update-v2')?.innerHTML?.slice(0, 2000)`
3. Adapt selectors based on what you find
4. Save working selectors to memory for future runs

### Pagination

After extracting posts from the current scroll position:
1. Scroll down 3 more times
2. Extract again (dedup by URL)
3. Stop after 3 rounds of scroll+extract per query, or if no new posts appear

### Login Check

Before searching, verify you're logged in:
1. Navigate to `https://www.linkedin.com/feed/`
2. Take a screenshot
3. If you see a login page, use the `linkedin-login` skill to authenticate first

### Output

After all queries are complete, you should have a collection of raw posts. Pass these to the post-ranking skill for analysis.
```

**Step 2: Verify the file exists and has valid frontmatter**

Run: `head -5 skills/job-finder/linkedin-search/skill.md`
Expected: Shows the frontmatter with name, description, triggers

**Step 3: Commit**

```bash
git add skills/job-finder/linkedin-search/skill.md
git commit -m "feat: add linkedin-search skill for job-finder persona"
```

---

### Task 2: Create the `post-extraction` skill

**Files:**
- Create: `skills/job-finder/post-extraction/skill.md`

**Step 1: Create the skill file**

```markdown
---
name: post-extraction
description: Extract structured data from LinkedIn post DOM elements with fallback patterns
triggers: [extract posts, parse linkedin, post data, dom extraction]
---

## Instructions

You extract structured data from LinkedIn posts visible in the browser. This skill handles the messy reality of LinkedIn's DOM.

### Primary Extraction Strategy

Use `browser_evaluate` to run JavaScript that extracts post data. LinkedIn's DOM structure varies, so try multiple selector strategies in order:

**Strategy 1 — Modern feed layout:**
```js
document.querySelectorAll('[data-urn*="urn:li:activity"]')
```

**Strategy 2 — Classic feed layout:**
```js
document.querySelectorAll('.feed-shared-update-v2')
```

**Strategy 3 — Search results layout:**
```js
document.querySelectorAll('.reusable-search__result-container')
```

### Fields to Extract

For each post, extract:

| Field | How to find | Fallback |
|-------|------------|----------|
| author | `.update-components-actor__name` text | First `<a>` with profile link text |
| authorTitle | `.update-components-actor__description` text | Text below author name |
| company | Parse from authorTitle (e.g., "CTO at Google" → "Google") | Empty string |
| text | `.feed-shared-update-v2__description` or `.break-words` | Largest text block in post |
| url | `a[href*="/feed/update/"]` href | Post container's data-urn converted to URL |
| postedAt | `.update-components-actor__sub-description` text | Empty string |

### Company Extraction

Parse company from authorTitle using patterns:
- "Role at Company" → Company
- "Company | Role" → Company
- "Role - Company" → Company
- If no pattern matches, leave empty — the ranking skill will handle it

### Deduplication

Before returning posts, deduplicate by URL. If URL is empty, deduplicate by author + first 100 chars of text.

### Error Recovery

If extraction returns 0 posts:
1. Take a screenshot to see what's on screen
2. Try `document.querySelectorAll('article')` as a last resort
3. If still nothing, the page may not have loaded — wait 2 seconds and retry
4. If LinkedIn shows a login wall or error, note it and move to next query

### Output Format

Return a JSON array of extracted posts. The ranking skill will process them next.
```

**Step 2: Verify**

Run: `head -5 skills/job-finder/post-extraction/skill.md`
Expected: Valid frontmatter

**Step 3: Commit**

```bash
git add skills/job-finder/post-extraction/skill.md
git commit -m "feat: add post-extraction skill for LinkedIn DOM parsing"
```

---

### Task 3: Create the `post-ranking` skill

**Files:**
- Create: `skills/job-finder/post-ranking/skill.md`

**Step 1: Create the skill file**

```markdown
---
name: post-ranking
description: Analyze and rank LinkedIn hiring posts by relevance, seniority match, location, and company fit
triggers: [rank posts, score posts, analyze posts, relevance, ranking]
---

## Instructions

You analyze and rank LinkedIn hiring posts against the user's search criteria. You are the quality filter — most posts won't be relevant.

### Scoring Criteria

Score each post from 0.0 to 1.0 based on these factors:

| Factor | Weight | Description |
|--------|--------|-------------|
| Direct hiring post | 0.30 | Is this a first-person "we're hiring" post (high) vs. a reshare or generic advice (low)? |
| Seniority match | 0.25 | Does the role match the requested seniority? (senior, staff, principal, director, etc.) |
| Location match | 0.20 | Does it match the requested location? (exact city > state > remote > no mention) |
| Company match | 0.15 | Does it match requested companies or company type? (named company > category match > no match) |
| Recency | 0.10 | How recently was it posted? (today > this week > older) |

### Scoring Rules

**Direct hiring signals (high score):**
- "We're hiring", "Join my team", "Open role", "Looking for", "DM me"
- Job title and requirements mentioned
- Application link or "apply" mentioned

**Not hiring signals (low score):**
- Generic career advice ("5 tips for interviews")
- Reshares without personal context
- Motivational posts mentioning work
- Posts about someone else's hiring (unless they tag the company)

**Seniority matching:**
- Exact match: 1.0 (asked for "senior", post says "senior")
- Adjacent match: 0.7 (asked for "senior", post says "staff" or "mid-level")
- No seniority mentioned: 0.5
- Wrong level: 0.2

### Output Format

For each post, produce:

```json
{
  "relevanceScore": 0.85,
  "rankingReason": "Direct hiring post for Senior Backend Engineer at Google Seattle. Exact seniority and location match.",
  "seniority": "senior",
  "location": "Seattle, WA",
  "company": "Google"
}
```

### Filtering

- Posts scoring below 0.3: discard entirely, don't save
- Posts scoring 0.3-0.5: save but mark as "low confidence"
- Posts scoring above 0.5: save as relevant matches

### Saving Results

After ranking, save qualifying posts to `~/.x-lens/linkedin-posts.jsonl` using the `shell` tool:

```bash
echo '<json_line>' >> ~/.x-lens/linkedin-posts.jsonl
```

Each line is a complete JSON object:

```json
{
  "id": "<sha256 of url>",
  "url": "https://linkedin.com/feed/update/...",
  "author": "Jane Smith",
  "authorTitle": "Engineering Manager at Google",
  "company": "Google",
  "text": "We're hiring senior backend engineers...",
  "postedAt": "2d ago",
  "capturedAt": "2026-03-08T10:30:00Z",
  "searchQuery": "hiring senior engineer Google Seattle",
  "sourcePrompt": "find posts hiring senior+ engineers at FAANG in Seattle",
  "relevanceScore": 0.85,
  "rankingReason": "Direct hiring post, senior+ level, Seattle location, FAANG company",
  "seniority": "senior",
  "location": "Seattle"
}
```

### Deduplication Before Saving

Before appending, check if the post already exists:

```bash
grep -c '"id":"<hash>"' ~/.x-lens/linkedin-posts.jsonl
```

If count > 0, skip. Otherwise append.

### Summary

After processing all posts, report:
- Total posts found across all queries
- Posts saved (above 0.3 threshold)
- Top 3 highest-scoring posts with brief description
- Any issues encountered (login problems, empty results, etc.)
```

**Step 2: Verify**

Run: `head -5 skills/job-finder/post-ranking/skill.md`
Expected: Valid frontmatter

**Step 3: Commit**

```bash
git add skills/job-finder/post-ranking/skill.md
git commit -m "feat: add post-ranking skill for LinkedIn post analysis"
```

---

### Task 4: Create the `linkedin-login` skill

**Files:**
- Create: `skills/job-finder/linkedin-login/skill.md`

**Step 1: Create the skill file**

```markdown
---
name: linkedin-login
description: Handle LinkedIn authentication using stored credentials with 2FA support
triggers: [linkedin login, authenticate, sign in, credentials, logged out]
---

## Instructions

You handle LinkedIn authentication. The browser uses a persistent profile so you should only need to log in once — subsequent runs will reuse the session cookies.

### Check Login State

Before doing anything, check if already logged in:

1. Navigate to `https://www.linkedin.com/feed/`
2. Take a screenshot
3. If you see the feed (posts, profile picture in nav), you're logged in — done
4. If you see a login form or "Join now" page, proceed with authentication

### Reading Credentials

Read credentials from `~/.x-lens/.linkedin-creds` using the shell tool:

```bash
cat ~/.x-lens/.linkedin-creds
```

The file format is:
```
email=your@email.com
password=yourpassword
```

Parse the email and password from this file.

**If the file doesn't exist**, notify the user:
"LinkedIn credentials not found. Please create ~/.x-lens/.linkedin-creds with your email and password:
```
email=your@email.com
password=yourpassword
```
Then re-run the job."

Save this to memory so you don't retry until the user confirms they've created the file.

### Login Flow

1. Navigate to `https://www.linkedin.com/login`
2. Type email into `input#username`
3. Type password into `input#password`
4. Click the sign-in button: `button[type="submit"]`
5. Wait 3 seconds, take a screenshot

### 2FA / Verification Handling

After clicking sign in, LinkedIn may show:
- **Email/SMS verification**: A code entry page. You CANNOT complete this automatically.
  - Send a notification: `[ALERT] LinkedIn 2FA Required | Check your email/phone for the verification code and enter it in the browser`
  - Wait 60 seconds, take another screenshot
  - If still on verification page, wait 60 more seconds
  - After 3 attempts (3 minutes total), give up and save to memory: "LinkedIn requires manual 2FA. User needs to log in manually once in the browser."

- **CAPTCHA**: Similar — cannot solve automatically.
  - Notify user and wait for manual completion

- **"Unusual activity" page**: LinkedIn sometimes blocks automated logins.
  - Notify user: "LinkedIn detected automated login. Please log in manually once using: x-lens --persona job-finder --visible"
  - Save to memory

### Success Verification

After login (or after 2FA), verify:
1. Navigate to `https://www.linkedin.com/feed/`
2. Take screenshot
3. If feed is visible, login successful — save to memory: "LinkedIn login successful as of <date>"
4. If not, report failure

### Manual Login Fallback

If automated login fails, instruct the user:
"Run `x-lens --persona job-finder --visible` and log in manually in the browser window. The persistent profile will save your session for future daemon runs."
```

**Step 2: Verify**

Run: `head -5 skills/job-finder/linkedin-login/skill.md`
Expected: Valid frontmatter

**Step 3: Commit**

```bash
git add skills/job-finder/linkedin-login/skill.md
git commit -m "feat: add linkedin-login skill with 2FA handling"
```

---

### Task 5: Generalize daemon system prompt for non-trader personas

Currently `daemon.ts:54-132` has a trader-specific system prompt hardcoded in `buildDaemonSystemPrompt()`. We need to make it work for any persona.

**Files:**
- Modify: `app/src/daemon.ts:54-132`

**Step 1: Write the test**

Create: `app/src/__tests__/daemon-prompt.test.ts`

```typescript
import { describe, it, expect } from "vitest";

// We'll test the exported function after refactoring
// For now, test that the prompt builder accepts persona and returns persona-specific content
describe("buildDaemonSystemPrompt", () => {
  it("should include persona name in prompt", async () => {
    // Import after daemon is refactored to export the function
    const { buildDaemonSystemPrompt } = await import("../daemon.js");
    const prompt = buildDaemonSystemPrompt([], "(no memory yet)", "job-finder");
    expect(prompt).toContain("job-finder");
    expect(prompt).not.toContain("trading analyst");
  });

  it("should include trader-specific content for trader persona", async () => {
    const { buildDaemonSystemPrompt } = await import("../daemon.js");
    const prompt = buildDaemonSystemPrompt([], "(no memory yet)", "trader");
    expect(prompt).toContain("trading");
    expect(prompt).toContain("market regime");
  });

  it("should include generic content for unknown personas", async () => {
    const { buildDaemonSystemPrompt } = await import("../daemon.js");
    const prompt = buildDaemonSystemPrompt([], "(no memory yet)", "some-new-persona");
    expect(prompt).toContain("some-new-persona");
    expect(prompt).toContain("skill_read");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/__tests__/daemon-prompt.test.ts`
Expected: FAIL — `buildDaemonSystemPrompt` is not exported

**Step 3: Refactor daemon.ts**

Export `buildDaemonSystemPrompt` and make it persona-aware. Replace the single hardcoded prompt with a generic base + persona-specific overlay:

In `app/src/daemon.ts`, replace the `buildDaemonSystemPrompt` function (lines 54-132) with:

```typescript
const PERSONA_PROMPTS: Record<string, string> = {
  trader: `You are NOT a passive task executor. You are a proactive market intelligence system. You have a full suite of trading skills — USE THEM ALL. Your job is to continuously monitor markets, detect opportunities and risks, and alert the user ONLY when something is actionable.

## Your Mission
- Detect market regime changes (GREEN → YELLOW → RED) and alert immediately
- Monitor sector rotation — which sectors are gaining/losing momentum
- Spot breakout setups (VCP, CANSLIM) across the market
- Track institutional positioning via open interest analysis
- Analyze earnings surprises and post-earnings drift opportunities
- Watch market breadth for divergences (price up but breadth deteriorating = danger)
- Monitor macro regime (Fed, yields, dollar, VIX) for shifts
- Identify high-conviction trade setups with entry/stop/target

## How to Think
For each scheduled run:
1. What is the CURRENT market regime? (Use market-regime-classifier, market-environment-analysis)
2. Is anything CHANGING? (Compare to your memory of previous runs)
3. Are there ACTIONABLE setups? (Use screeners, OI analysis, earnings calendar)
4. Should the user be ALERTED? (Only for high-conviction, time-sensitive findings)
5. What should you REMEMBER? (Save learnings, update your model of the market)

## Alert Criteria — Only notify when:
- Market regime changes (e.g., GREEN → YELLOW)
- High-confidence trade setup found (>65% conviction with clear entry/stop/target)
- Significant OI positioning shift detected (institutional accumulation/distribution)
- Market drop >1% intraday or sharp sector rotation
- Earnings surprise with PEAD opportunity
- Something you've been tracking hits a trigger level

## DO NOT alert for:
- Routine scans with no signal
- Low-confidence findings (<55%)
- Information the user already knows (check memory)
- Minor price fluctuations`,

  "job-finder": `You are a LinkedIn job search specialist. Your job is to find relevant hiring posts on LinkedIn based on the user's search criteria.

## Your Mission
- Decompose natural language job search prompts into multiple LinkedIn search queries
- Navigate LinkedIn, scroll through results, and extract hiring posts
- Analyze and rank posts by relevance (seniority match, location, company, directness)
- Save qualifying posts to ~/.x-lens/linkedin-posts.jsonl
- Deduplicate against previously saved posts

## How to Think
For each scheduled run:
1. Read the search prompt — what role, seniority, location, companies?
2. Generate 5-10 LinkedIn search queries covering different angles
3. For each query: search, scroll, extract posts (use linkedin-search skill)
4. Rank all found posts (use post-ranking skill)
5. Save posts scoring above 0.3 to the JSONL file
6. Report summary: total found, saved, top matches

## Alert Criteria — Notify when:
- Found 1+ posts scoring above 0.7 (high relevance match)
- New company posting for the target role (not seen before)

## DO NOT alert for:
- Runs that find 0 new posts
- Low-relevance posts (below 0.5)

## LinkedIn-Specific Notes
- Always check login state first (use linkedin-login skill if needed)
- LinkedIn rate-limits aggressive scrolling — pause 2-3 seconds between scrolls
- If LinkedIn shows a CAPTCHA or blocks you, stop immediately and notify the user
- Save working CSS selectors to memory when you find ones that work`,
};

export function buildDaemonSystemPrompt(
  skills: ReturnType<typeof loadSkills>,
  memory: string,
  persona: string,
): string {
  const skillsSection = formatSkillsForPrompt(skills);

  const personaInstructions = PERSONA_PROMPTS[persona] || `You are an autonomous agent running as the "${persona}" persona. Follow your available skills to complete scheduled tasks effectively.

## How to Think
For each scheduled run:
1. Read the task prompt carefully
2. Check available skills — use skill_read to load relevant ones
3. Execute the task using browser, shell, fetch, and other tools
4. Save important findings to memory
5. Alert the user only for actionable, high-confidence findings`;

  return `You are x-lens, an autonomous agent running 24/7 as the "${persona}" persona.

${personaInstructions}

## Skill Usage Protocol
1. BEFORE doing anything, scan the Available Skills list below
2. If ANY skill matches, call skill_read to load its full instructions FIRST
3. Follow the skill's instructions exactly — they contain proven workflows
4. Chain multiple skills together when the situation calls for it
5. Use general capabilities (browser, fetch, shell) to fill gaps between skills

## Schedule Management
You can create, modify, and delete your own monitoring schedules:
- schedule_create: Add new monitoring jobs
- schedule_delete: Remove jobs that aren't producing value
- schedule_list: Review your current schedule

## Notification Format
When you find something actionable, include this marker:
[ALERT] <short title> | <1-2 sentence summary>

## Your Memory
${memory}

You MUST save important findings to memory using memory_append. This is how you learn across runs.

${skillsSection}`;
}
```

**Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/__tests__/daemon-prompt.test.ts`
Expected: PASS — all 3 tests

**Step 5: Run full test suite to verify nothing broke**

Run: `cd app && npx vitest run`
Expected: All existing tests still pass

**Step 6: Commit**

```bash
git add app/src/daemon.ts app/src/__tests__/daemon-prompt.test.ts
git commit -m "refactor: generalize daemon system prompt for multi-persona support"
```

---

### Task 6: Add per-persona browser profile directories

Currently all personas share `~/.x-lens/browser-profile/`. Each persona needs its own profile so LinkedIn cookies don't conflict with trading site cookies.

**Files:**
- Modify: `app/src/daemon.ts:163-201` (getOrCreatePersonaAgent)
- Modify: `app/src/browser.ts:24` (DEFAULT_PROFILE_DIR)

**Step 1: Update BrowserController to accept profileDir per persona**

In `app/src/daemon.ts`, change line 173 in `getOrCreatePersonaAgent`:

```typescript
// Before:
const browser = new BrowserController({ headless: true });

// After:
const profileDir = join(homedir(), ".x-lens", "browser-data", persona);
const browser = new BrowserController({ headless: true, profileDir });
```

Add the `join` and `homedir` imports if not already present (they are — line 5-6).

**Step 2: Verify the build compiles**

Run: `cd app && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add app/src/daemon.ts
git commit -m "feat: per-persona browser profile directories"
```

---

### Task 7: Add job-finder persona system prompt to daemon seeding

The daemon currently only seeds default jobs for the `trader` persona. The `job-finder` persona doesn't need default jobs (user creates them), but we should log a helpful message.

**Files:**
- Modify: `app/src/daemon.ts:444-515`

**Step 1: Update the seeding logic**

In `daemon.ts`, after the trader seeding block (around line 515), add a log for non-trader personas with no jobs:

```typescript
// After the existing trader seeding block:
if (existingForPersona.length === 0 && persona !== "trader") {
  log(`No jobs found for persona "${persona}". Create jobs via REPL: x-lens --persona ${persona} "your prompt here"`);
}
```

**Step 2: Verify the build compiles**

Run: `cd app && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add app/src/daemon.ts
git commit -m "feat: helpful log message for personas with no jobs"
```

---

### Task 8: Verify end-to-end skill loading for job-finder persona

**Files:**
- Create: `app/src/__tests__/job-finder-skills.test.ts`

**Step 1: Write the integration test**

```typescript
import { describe, it, expect } from "vitest";
import { loadSkills, listPersonas } from "../skills.js";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../../..");

describe("job-finder persona", () => {
  it("should appear in persona list", () => {
    const personas = listPersonas(PROJECT_ROOT);
    expect(personas).toContain("job-finder");
  });

  it("should load job-finder skills", () => {
    const skills = loadSkills(PROJECT_ROOT, "job-finder");
    const names = skills.map((s) => s.name);
    expect(names).toContain("linkedin-search");
    expect(names).toContain("post-extraction");
    expect(names).toContain("post-ranking");
    expect(names).toContain("linkedin-login");
  });

  it("should also load global skills", () => {
    const skills = loadSkills(PROJECT_ROOT, "job-finder");
    // Global skills should be loaded too
    expect(skills.length).toBeGreaterThan(4);
  });
});
```

**Step 2: Run the test**

Run: `cd app && npx vitest run src/__tests__/job-finder-skills.test.ts`
Expected: PASS — all 3 tests (skills directory exists from Tasks 1-4)

**Step 3: Commit**

```bash
git add app/src/__tests__/job-finder-skills.test.ts
git commit -m "test: verify job-finder persona skill loading"
```

---

### Task 9: Update README with job-finder documentation

**Files:**
- Modify: `README.md`

**Step 1: Add job-finder section to README**

After the existing Daemon section, add:

```markdown
### Job-Finder Persona

The `job-finder` persona searches LinkedIn for hiring posts and saves ranked results.

**Setup:**

1. Create LinkedIn credentials file:
```bash
echo "email=your@email.com" > ~/.x-lens/.linkedin-creds
echo "password=yourpassword" >> ~/.x-lens/.linkedin-creds
```

2. Log in manually once (for 2FA/CAPTCHA):
```bash
x-lens --persona job-finder --visible
# Then say: "Log into LinkedIn"
```

3. Create a search job:
```bash
x-lens --persona job-finder "find posts about hiring senior+ backend engineers at FAANG in Seattle"
```

4. Or run as daemon:
```bash
x-lens daemon start --persona job-finder
```

**Results** are saved to `~/.x-lens/linkedin-posts.jsonl` — one JSON object per line with author, company, text, URL, relevance score, and ranking reason.

**Skills:**
| Skill | Purpose |
|-------|---------|
| `linkedin-search` | Decompose prompts into search queries |
| `post-extraction` | Extract structured data from LinkedIn DOM |
| `post-ranking` | Score and rank posts by relevance |
| `linkedin-login` | Handle authentication and 2FA |
```

**Step 2: Verify README renders correctly**

Run: `head -20 README.md` (just to sanity check)

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add job-finder persona documentation"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | linkedin-search skill | `skills/job-finder/linkedin-search/skill.md` |
| 2 | post-extraction skill | `skills/job-finder/post-extraction/skill.md` |
| 3 | post-ranking skill | `skills/job-finder/post-ranking/skill.md` |
| 4 | linkedin-login skill | `skills/job-finder/linkedin-login/skill.md` |
| 5 | Generalize daemon system prompt | `app/src/daemon.ts`, `app/src/__tests__/daemon-prompt.test.ts` |
| 6 | Per-persona browser profiles | `app/src/daemon.ts` |
| 7 | Job seeding message for non-trader | `app/src/daemon.ts` |
| 8 | Integration test for skill loading | `app/src/__tests__/job-finder-skills.test.ts` |
| 9 | README docs | `README.md` |
