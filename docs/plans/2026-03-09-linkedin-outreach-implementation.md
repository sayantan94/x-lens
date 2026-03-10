# LinkedIn Outreach Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add autonomous LinkedIn outreach to the job-finder persona — the agent finds high-scoring posts, drafts casual messages, sends connection requests/DMs, and logs everything.

**Architecture:** One new skill (`linkedin-outreach`) handles the outreach workflow. Default daemon jobs are seeded for job-finder (same pattern as trader). The persona prompt in `daemon.ts` is updated with outreach authorization and guidelines.

**Tech Stack:** Markdown skill files, TypeScript (daemon.ts modifications)

---

### Task 1: Create the `linkedin-outreach` skill

**Files:**
- Create: `skills/job-finder/linkedin-outreach/skill.md`

**Step 1: Create the skill directory**

Run: `mkdir -p skills/job-finder/linkedin-outreach`

**Step 2: Write the skill file**

Create `skills/job-finder/linkedin-outreach/skill.md` with the following content:

```markdown
---
name: linkedin-outreach
description: Send personalized connection requests and messages to LinkedIn hiring managers and recruiters from high-scoring posts. Use when posts have been ranked and scored above 0.7, or when the prompt mentions "reach out", "connect", "message", or "outreach". Reads from linkedin-posts.jsonl, deduplicates against linkedin-outreach.jsonl, and sends via browser automation.
triggers: [outreach, reach out, connect, message, send connection, contact recruiter, contact hiring manager, linkedin message, networking]
---

# LinkedIn Outreach

## Instructions

### Step 1: Verify Login
1. Navigate to `https://www.linkedin.com/feed/`
2. Take a screenshot
   - Expected: LinkedIn feed with posts, navigation bar showing "Home", "My Network"
3. If you see a login/signup page, load the `linkedin-login` skill via `skill_read` and follow it before continuing

### Step 2: Load High-Scoring Posts
1. Read the posts file: `cat ~/.x-lens/linkedin-posts.jsonl`
2. Filter for posts with `relevanceScore >= 0.7`
3. Parse each JSON line and collect: `url`, `author`, `authorTitle`, `company`, `text`, `relevanceScore`

   - Expected: A list of high-scoring posts with author information
   - If file is empty or missing: report "No posts to process. Run linkedin-search and post-ranking first." and stop.
   - If no posts score >= 0.7: report "No high-scoring posts found (all below 0.7). Lower the threshold or refine search queries." and stop.

### Step 3: Filter Out Already-Contacted Authors
1. Check if outreach log exists: `test -f ~/.x-lens/linkedin-outreach.jsonl && echo exists`
2. If it exists, read it: `cat ~/.x-lens/linkedin-outreach.jsonl`
3. For each high-scoring post, check if the author's profile URL hash already appears in the outreach log with a `sentAt` date within the last 30 days
4. Remove any already-contacted authors from the list

   - Expected: A filtered list of authors who haven't been contacted recently
   - If all authors were already contacted: report "All high-scoring post authors already contacted in the last 30 days." and stop.

### Step 4: Outreach Loop (max 10 per run)
For each eligible post (up to 10 per run):

#### 4a: Visit Author Profile
1. Extract the author's LinkedIn profile URL from the post. If the post has an `authorProfileUrl` field, use it. Otherwise, search LinkedIn for the author name + company.
2. Navigate to the author's profile page
3. Take a screenshot
4. Note: their current role, company, headline, and whether you are already connected

   - Expected: Author's LinkedIn profile page visible with their info
   - If profile is not found or is private: skip this author, move to next

#### 4b: Draft Message
Compose a casual, personalized message. Follow these rules:
- Keep connection request notes under 300 characters (LinkedIn limit)
- Direct messages can be up to 500 characters
- Reference the specific post or role they mentioned
- Mention one relevant thing about your background
- Casual tone, no corporate-speak
- No "Dear", no "I believe I'd be a strong fit", no "I'm reaching out because"

**Connection request note template** (adapt, don't copy verbatim):
```
Hey [FirstName], saw your post about hiring a [Role] at [Company] — I've been working on [relevant experience] and this sounds like a great match. Would love to connect!
```

**Direct message template** (for existing connections):
```
Hey [FirstName], noticed you posted about a [Role] opening at [Company]. I've been doing [relevant work] for [N years] and this really caught my eye. Would you be open to a quick chat about it?
```

   - Expected: A message under the character limit that references the specific post
   - If the post doesn't have enough context to personalize: use a shorter, more generic connection note

#### 4c: Send the Message
**If NOT connected:**
1. Click the "Connect" button on their profile
2. If LinkedIn shows "Add a note" option, click it
3. Type the connection request note (under 300 chars)
4. Click "Send"
5. Take a screenshot to confirm

**If already connected:**
1. Click the "Message" button on their profile
2. Type the direct message
3. Click Send
4. Take a screenshot to confirm

   - Expected: Connection request sent or message delivered
   - If "Connect" button is not visible (e.g., "Follow" only): skip this author. Some profiles restrict connection requests.
   - If LinkedIn shows a "How do you know [Name]?" prompt: select "Other" and proceed
   - If LinkedIn shows a weekly invitation limit warning: STOP all outreach for this run. Report the limit and stop.

#### 4d: Log the Outreach
1. Generate ID: `echo -n "<profileUrl>" | shasum -a 256 | cut -c1-16`
2. Append a JSONL record to `~/.x-lens/linkedin-outreach.jsonl`:

```json
{
  "id": "<sha256 hash of profile URL>",
  "profileUrl": "https://linkedin.com/in/...",
  "name": "Jane Smith",
  "title": "Engineering Manager at Acme",
  "postUrl": "https://linkedin.com/feed/update/...",
  "messageType": "connection_request",
  "messageSent": "Hey Jane, saw your post about...",
  "sentAt": "2026-03-09T18:00:00Z",
  "sourceJobId": "linkedin-outreach"
}
```

Run: `echo '<json_line>' >> ~/.x-lens/linkedin-outreach.jsonl`

   - Expected: Record appended to outreach log
   - If file doesn't exist yet: `mkdir -p ~/.x-lens && touch ~/.x-lens/linkedin-outreach.jsonl` first

### Step 5: Summary Report
After processing all eligible posts (or hitting the 10-per-run cap), report:

1. **Totals**: posts reviewed, authors skipped (already contacted), outreach sent
2. **Sent list**: for each outreach — name, company, message type (connection/DM), message preview
3. **Skipped**: any authors skipped and why (private profile, no Connect button, already contacted)
4. **Rate limit**: if LinkedIn's weekly limit was hit, report it

   - Expected: Concise summary scannable in 30 seconds

CRITICAL: If LinkedIn shows ANY warning about invitation limits or suspicious activity, STOP immediately. Do not try to work around rate limits. Report the warning and stop.

## Performance Notes
- Max 10 outreach actions per run to stay under LinkedIn's radar
- LinkedIn's weekly connection request limit is approximately 100. The daemon runs once daily on weekdays, sending up to 10 per run (50/week max), well under the limit.
- Always wait 2-3 seconds between profile visits to avoid triggering rate limits
- Connection request notes have a hard 300-character limit enforced by LinkedIn's UI

## Examples

### Example 1: Connection request to hiring manager
Post: "We're hiring a Senior Backend Engineer at Stripe! Seattle, hybrid."
Author: Jane Smith, Engineering Manager at Stripe

Actions:
1. Visit Jane's profile
2. Draft: "Hey Jane, saw your post about the Senior Backend Engineer role at Stripe — I've been building distributed systems and APIs for the past few years and this sounds like a great fit. Would love to connect!"
3. Click Connect → Add a note → paste message → Send
4. Log to outreach JSONL

### Example 2: Direct message to existing connection
Post: "My team at Google is looking for Senior SWEs. DM me if interested."
Author: Bob Lee (already connected)

Actions:
1. Visit Bob's profile, see "Message" button (already connected)
2. Draft: "Hey Bob, saw your post about Senior SWE openings on your team at Google. I've been working on large-scale backend systems and this caught my eye. Would you be open to a quick chat?"
3. Click Message → type → Send
4. Log to outreach JSONL

### Example 3: LinkedIn invitation limit reached
After sending 6 connection requests in this run, LinkedIn shows: "You've reached the weekly invitation limit."

Actions:
1. STOP immediately
2. Report: "LinkedIn weekly invitation limit reached after 6 outreach actions. 6 sent, 4 remaining skipped. Will retry next run."
3. Log the 6 successful outreach actions

## Troubleshooting

### "Connect" button not visible
Cause: Author has restricted connection requests, or you need LinkedIn Premium for InMail
Solution: Skip this author. Log as "skipped — no Connect button"

### LinkedIn shows CAPTCHA or security check
Cause: Too many profile visits in short time
Solution: STOP outreach for this run. Report the issue. Wait for next scheduled run.

### Outreach JSONL has duplicate entries
Cause: Same author reached via different posts
Solution: Dedup check in Step 3 uses profile URL hash, not post URL. Same person from different posts = one outreach.

### Profile URL not in post data
Cause: Post extraction didn't capture the author's profile link
Solution: Search LinkedIn for "author name" + "company" to find their profile. If ambiguous, skip.
```

**Step 3: Verify the skill loads**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens && node -e "const { loadSkills } = require('./app/dist/skills.js'); const s = loadSkills('.', 'job-finder'); console.log(Object.keys(s));"`

Expected: Output includes `linkedin-outreach` in the skill list

**Step 4: Commit**

```bash
git add skills/job-finder/linkedin-outreach/skill.md
git commit -m "feat: add linkedin-outreach skill for autonomous messaging"
```

---

### Task 2: Create outreach message templates reference

**Files:**
- Create: `skills/job-finder/linkedin-outreach/references/message-templates.md`

**Step 1: Create the references directory**

Run: `mkdir -p skills/job-finder/linkedin-outreach/references`

**Step 2: Write the reference file**

Create `skills/job-finder/linkedin-outreach/references/message-templates.md`:

```markdown
# Message Templates

## Connection Request Notes (max 300 characters)

These are starting points. Always personalize based on the post content and author's profile.

### Hiring Manager Posted a Role
```
Hey [FirstName], saw your post about the [Role] at [Company] — I've been working on [relevant area] and this sounds like a great match. Would love to connect!
```

### Recruiter "We're Hiring" Post
```
Hey [FirstName], noticed [Company] is hiring [Role]s — I have [N] years in [domain] and would love to learn more. Mind if we connect?
```

### Generic Hiring Signal (no specific role mentioned)
```
Hey [FirstName], saw your post about growing the engineering team at [Company]. I'm a Senior SWE focused on [area] — would love to connect!
```

## Direct Messages (max 500 characters, for existing connections)

### Specific Role Posted
```
Hey [FirstName], noticed you posted about a [Role] opening at [Company]. I've been doing [relevant work] for [N years] and this really caught my eye. Would you be open to a quick chat about it?
```

### Team Growth / General Hiring
```
Hey [FirstName], saw your post about expanding the team at [Company]. I've been building [relevant systems] and would love to hear more about what you're looking for. Open to a quick chat?
```

## Rules
1. Never start with "Dear" or "I'm reaching out because"
2. Never say "I believe I'd be a strong fit" or "I'm confident I can add value"
3. Always reference the specific post or role
4. Keep it conversational — write like you're texting a professional acquaintance
5. One ask per message: "connect" or "chat" — not both
6. No attachments, no resume links in the first message
```

**Step 3: Commit**

```bash
git add skills/job-finder/linkedin-outreach/references/message-templates.md
git commit -m "feat: add message templates reference for linkedin-outreach"
```

---

### Task 3: Seed default daemon jobs for job-finder persona

**Files:**
- Modify: `app/src/daemon.ts:526-600`

**Step 1: Update the job seeding block**

In `daemon.ts`, find the block at line 598:

```typescript
if (existingForPersona.length === 0 && persona !== "trader") {
    log(`No jobs found for persona "${persona}". Create jobs via REPL: x-lens --persona ${persona} "your prompt here"`);
}
```

Replace it with:

```typescript
if (existingForPersona.length === 0 && persona === "job-finder") {
    log(`No jobs found for persona "${persona}" — seeding default LinkedIn outreach schedule`);

    const jobFinderJobs: CreateJobInput[] = [
      {
        id: "linkedin-job-search",
        persona: "job-finder",
        prompt: "Search LinkedIn for Senior Software Engineer roles. Use the linkedin-search skill to generate diverse queries covering: 'senior software engineer hiring', 'senior SWE open role', 'hiring backend engineer senior', and company-specific queries for top tech companies. Extract and rank all posts using post-extraction and post-ranking skills. Save posts scoring above 0.3 to ~/.x-lens/linkedin-posts.jsonl.",
        type: "cron",
        schedule: "0 14 * * 1-5", // 9 AM ET = 2 PM UTC
        notify: true,
      },
      {
        id: "linkedin-feed-scan",
        persona: "job-finder",
        prompt: "Scan your LinkedIn feed for recent hiring posts. Scroll through the feed and look for posts containing: 'we\\'re hiring', 'join my team', 'open role', 'looking for engineers', 'growing the team'. Extract and rank any relevant posts using post-extraction and post-ranking skills. Focus on Senior Software Engineer or equivalent roles.",
        type: "cron",
        schedule: "0 16 * * 1-5", // 11 AM ET = 4 PM UTC
        notify: true,
      },
      {
        id: "linkedin-outreach",
        persona: "job-finder",
        prompt: "Process high-scoring posts and send outreach. Use the linkedin-outreach skill to: read posts scoring >= 0.7 from ~/.x-lens/linkedin-posts.jsonl, check ~/.x-lens/linkedin-outreach.jsonl to skip anyone contacted in the last 30 days, visit each author's profile, draft a casual personalized connection request or message, and send it. Max 10 outreach actions per run. Log all outreach to ~/.x-lens/linkedin-outreach.jsonl.",
        type: "cron",
        schedule: "0 18 * * 1-5", // 1 PM ET = 6 PM UTC
        notify: true,
      },
      {
        id: "outreach-summary",
        persona: "job-finder",
        prompt: "Weekly outreach summary. Read ~/.x-lens/linkedin-outreach.jsonl and ~/.x-lens/linkedin-posts.jsonl. Report: total outreach sent this week, breakdown by connection request vs direct message, top companies contacted, total high-scoring posts in pipeline, and any LinkedIn rate limit issues encountered. Check LinkedIn notifications for any responses to previous outreach and report those too.",
        type: "cron",
        schedule: "0 22 * * 5", // 5 PM ET Friday = 10 PM UTC
        notify: true,
      },
    ];

    for (const job of jobFinderJobs) {
      try {
        jobStore.create(job);
        log(`  Created default job: ${job.id}`);
      } catch (err) {
        logError(`  Failed to create default job ${job.id}: ${err}`);
      }
    }
  }

  if (existingForPersona.length === 0 && persona !== "trader" && persona !== "job-finder") {
    log(`No jobs found for persona "${persona}". Create jobs via REPL: x-lens --persona ${persona} "your prompt here"`);
  }
```

**Step 2: Build to verify**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && npm run build`

Expected: TypeScript compiles without errors

**Step 3: Commit**

```bash
git add app/src/daemon.ts
git commit -m "feat: seed default daemon jobs for job-finder persona"
```

---

### Task 4: Update job-finder persona prompt with outreach authorization

**Files:**
- Modify: `app/src/daemon.ts:99-125`

**Step 1: Update the persona prompt**

In `daemon.ts`, find the `"job-finder"` entry in `PERSONA_PROMPTS` (around line 99). Replace the entire object with:

```typescript
"job-finder": {
    intro: `You are a fully autonomous LinkedIn job search and outreach agent. Your job is to find Senior Software Engineer roles on LinkedIn, rank them by relevance, and proactively reach out to hiring managers and recruiters — all without human approval.`,
    mission: `## Your Mission
- Decompose job search prompts into targeted LinkedIn search queries
- Execute LinkedIn searches and scroll through results
- Extract job posts, listings, and relevant professional content
- Rank extracted posts by relevance to the user's criteria
- Save posts scoring above 0.3 to ~/.x-lens/linkedin-posts.jsonl
- For posts scoring above 0.7: proactively reach out to the author via connection request or direct message
- Log all outreach to ~/.x-lens/linkedin-outreach.jsonl
- Never message the same person twice within 30 days
- Cap outreach at 10 actions per run to avoid LinkedIn rate limits
- Report a summary of findings and outreach after each run`,
    howToThink: `## How to Think
For each scheduled run:
1. Read the prompt and understand what roles/companies/criteria to target
2. Generate multiple LinkedIn search queries to maximize coverage
3. Search and scroll through LinkedIn results, extracting posts and listings
4. Rank each extracted post by relevance (0.0–1.0)
5. Save all posts scoring above 0.3 to ~/.x-lens/linkedin-posts.jsonl
6. For outreach runs: read high-scoring posts, draft casual personalized messages, and send connection requests or DMs
7. Always check ~/.x-lens/linkedin-outreach.jsonl before contacting anyone — skip if contacted in last 30 days
8. Use casual, conversational tone in all messages — no corporate-speak
9. Keep connection request notes under 300 characters (LinkedIn limit)
10. If LinkedIn shows any rate limit warning, STOP immediately and report it`,
    alertCriteria: `## Alert Criteria — Only notify when:
- 1+ posts scoring above 0.7 relevance found
- A new company starts posting for the target role
- Outreach was sent — include count and names
- LinkedIn rate limit or security warning encountered
- Responses received to previous outreach`,
    doNotAlert: `## DO NOT alert for:
- 0 new posts found in a scan
- Low-relevance posts scoring below 0.5
- Duplicate posts already saved in previous runs
- Generic company updates unrelated to job search
- Routine feed scans with nothing new`,
  },
```

**Step 2: Build to verify**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && npm run build`

Expected: TypeScript compiles without errors

**Step 3: Commit**

```bash
git add app/src/daemon.ts
git commit -m "feat: update job-finder persona prompt with outreach authorization"
```

---

### Task 5: Verify end-to-end skill loading

**Step 1: Build the app**

Run: `cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/app && npm run build`

Expected: Clean build, no errors

**Step 2: Verify job-finder skills include linkedin-outreach**

Run: `ls -la skills/job-finder/`

Expected: Five directories: `linkedin-login`, `linkedin-search`, `post-extraction`, `post-ranking`, `linkedin-outreach`

**Step 3: Verify skill file is valid**

Run: `head -5 skills/job-finder/linkedin-outreach/skill.md`

Expected: YAML frontmatter with `name: linkedin-outreach`

**Step 4: Commit (if any fixes needed)**

Only commit if fixes were required. Otherwise, all tasks are done.
