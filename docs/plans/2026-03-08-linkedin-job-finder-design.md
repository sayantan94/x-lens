# LinkedIn Job-Finder Persona Design

**Goal:** A new `job-finder` persona that searches LinkedIn for hiring-related posts based on natural language prompts, analyzes and ranks them, and stores results for later review.

**Architecture:** Agent decomposes NLP prompts into multiple LinkedIn search queries, navigates LinkedIn via existing Playwright browser tools, extracts and ranks posts, saves to JSONL. No new tools or Chrome extension — pure skills on top of existing infrastructure.

---

## Data Flow

```
User prompt (NLP) → daemon job prompt field
  → Agent decomposes into LinkedIn search queries
  → Playwright navigates LinkedIn, scrolls, extracts posts
  → Agent analyzes & ranks posts (relevance, recency, seniority match)
  → Appends ranked posts to ~/.x-lens/linkedin-posts.jsonl
  → Notification: "Found N new posts"
```

## Post Schema

Each line in `~/.x-lens/linkedin-posts.jsonl`:

```json
{
  "id": "sha256-of-url",
  "url": "https://linkedin.com/feed/update/urn:li:activity:123",
  "author": "Jane Smith",
  "authorTitle": "Engineering Manager at Google",
  "company": "Google",
  "text": "We're hiring senior backend engineers in Seattle...",
  "postedAt": "2026-03-07T...",
  "capturedAt": "2026-03-08T10:30:00Z",
  "searchQuery": "hiring senior engineer Google Seattle",
  "sourcePrompt": "find posts hiring senior+ engineers at FAANG in Seattle",
  "relevanceScore": 0.92,
  "rankingReason": "Direct hiring post, senior+ level, matches Seattle location, FAANG company",
  "seniority": "senior",
  "location": "Seattle",
  "screenshot": "linkedin-posts/abc123.png"
}
```

**Deduplication:** Posts keyed by `id` (SHA256 of URL). Skip already-seen posts.

**Screenshots:** Saved to `~/.x-lens/linkedin-posts/` directory, referenced by filename in JSONL.

## Persona Skills

New directory: `skills/job-finder/` with 4 skills:

### 1. linkedin-search
How to decompose an NLP prompt into multiple LinkedIn search queries. Navigate to `linkedin.com/search/results/content/?keywords=...`. Handle pagination and scrolling.

### 2. post-extraction
Extract structured data from LinkedIn post DOM: author, title, company, text, URL, timestamp. CSS selectors, fallback patterns, handling different post formats (text posts, reshares, articles).

### 3. post-ranking
Scoring criteria:
- Direct hiring post vs. reshare (higher score for direct)
- Seniority match (senior+, staff, principal)
- Location match
- Company match
- Recency (newer = higher)
- Scoring: 0.0 to 1.0 relevance score with reasoning

### 4. linkedin-login
Handle login state: check if logged in, navigate to login if not, type credentials, handle 2FA (notify user to complete manually). Credentials read from `~/.x-lens/.linkedin-creds`.

## Credential Storage

`~/.x-lens/.linkedin-creds`:
```
email=you@email.com
password=yourpassword
```

Plain key=value file. Gitignored.

## Daemon Integration

- **No default jobs** — user creates jobs via REPL or `schedule_create`
- Example: `x-lens --persona job-finder "find posts about hiring senior+ backend engineers at FAANG in Seattle"`
- Job type: `interval` (default 120 min) or `cron`

## Browser Profile Persistence

Playwright launches with `--user-data-dir=~/.x-lens/browser-data/job-finder/` so LinkedIn login session survives across daemon restarts. Each persona gets its own browser profile directory.

This is a new pattern that also benefits the trader persona (no re-login to financial sites).

## Session & Memory

- Session: `~/.x-lens/sessions/job-finder.jsonl` (same pattern as trader)
- Memory: shared `~/.x-lens/MEMORY.md` (agent writes job-finder-specific learnings here)

## Notifications

Sends "Found N new relevant posts" after each run via terminal-notifier.

## No New Tools

Everything uses existing tools:
- `browser_navigate`, `browser_screenshot`, `browser_click`, `browser_type`, `browser_scroll`, `browser_evaluate` — for LinkedIn interaction
- `memory_read`, `memory_write`, `memory_append` — for persistence
- `skill_read` — for loading LinkedIn-specific skills
- `shell` — for file I/O (writing JSONL, reading creds)
- `schedule_create`, `schedule_delete`, `schedule_list` — for job management
