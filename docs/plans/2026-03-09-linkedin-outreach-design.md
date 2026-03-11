# LinkedIn Outreach — Design

## Goal

Make the job-finder persona fully autonomous: search for Senior Software Engineer roles on LinkedIn, identify hiring managers and recruiters, and send personalized connection requests or messages without human approval.

## Architecture

Extends the existing job-finder pipeline (search → extract → rank) with an outreach stage. A new `linkedin-outreach` skill reads high-scoring posts from `~/.x-lens/linkedin-posts.jsonl`, navigates to the author's profile, drafts a casual message, and sends it. Four default daemon jobs create an always-running pipeline: two discovery jobs populate the JSONL, one outreach job acts on it, and a weekly summary job recaps activity.

## New Skill: `linkedin-outreach`

**Location:** `skills/job-finder/linkedin-outreach/skill.md`

**Workflow:**

1. Read `~/.x-lens/linkedin-posts.jsonl` for posts with `relevanceScore >= 0.7`
2. Read `~/.x-lens/linkedin-outreach.jsonl` to skip anyone contacted in the last 30 days
3. For each eligible post:
   a. Navigate to the author's LinkedIn profile
   b. Extract context: role, company, recent activity
   c. Draft a casual, personalized connection request or message (under 300 chars for connection notes)
   d. Send the connection request (with note) or direct message if already connected
   e. Log to `~/.x-lens/linkedin-outreach.jsonl`
4. Cap at 10 outreach actions per run to avoid LinkedIn rate limits

**Message style:** Casual and conversational. Reference the specific post or role. No corporate-speak. Example: "Hey Jane, saw you're hiring a Senior SWE at Acme — I've been building distributed systems for 5+ years and this looks like a great match. Would love to chat."

**Deduplication:** Track by SHA256 hash of author profile URL. Skip anyone contacted within 30 days.

## Default Daemon Jobs

Seeded on first `x-lens daemon start --persona job-finder`, same pattern as trader persona.

| Job ID | Type | Schedule | Description |
|--------|------|----------|-------------|
| `linkedin-job-search` | cron | `0 14 * * 1-5` (9 AM ET) | Search LinkedIn for Senior SWE roles, extract and rank posts |
| `linkedin-feed-scan` | cron | `0 16 * * 1-5` (11 AM ET) | Scan LinkedIn feed for "we're hiring" posts from recruiters and hiring managers |
| `linkedin-outreach` | cron | `0 18 * * 1-5` (1 PM ET) | Process high-scoring posts, send connection requests and messages |
| `outreach-summary` | cron | `0 22 * * 5` (5 PM ET, Fridays) | Weekly recap: outreach count, responses, pipeline status |

All jobs have `notify: true`. Outreach job notifies with count of messages sent. Feed scan notifies when posts score above 0.7.

## Persona Prompt Updates

Add to the job-finder persona prompt in `daemon.ts`:

- Authorized to send connection requests and messages autonomously, no approval needed
- Use casual/conversational tone, keep connection notes under 300 chars (LinkedIn limit)
- Never message the same person twice within 30 days
- Cap at 10 outreach actions per run
- Always log outreach to `~/.x-lens/linkedin-outreach.jsonl`
- When scanning feed, look for: "we're hiring", "join my team", "open role", "looking for engineers"

## Outreach Log Format

**File:** `~/.x-lens/linkedin-outreach.jsonl`

```json
{
  "id": "<sha256 of profile URL>",
  "profileUrl": "https://linkedin.com/in/...",
  "name": "Jane Smith",
  "title": "Engineering Manager at Acme",
  "postUrl": "https://linkedin.com/feed/...",
  "messageType": "connection_request | direct_message",
  "messageSent": "Hey Jane, saw you're hiring a Senior SWE...",
  "sentAt": "2026-03-09T18:00:00Z",
  "sourcePostId": "linkedin-outreach"
}
```

## What Does Not Change

- Existing 4 skills (linkedin-login, linkedin-search, post-extraction, post-ranking)
- Daemon execution pipeline in `daemon.ts`
- Tool definitions in `tools.ts`
- Skill loading in `skills.ts`

## Files to Create or Modify

- **Create:** `skills/job-finder/linkedin-outreach/skill.md` — outreach skill instructions
- **Create:** `skills/job-finder/linkedin-outreach/references/message-templates.md` — example messages and guidelines
- **Modify:** `app/src/daemon.ts` — add default jobs for job-finder persona, update persona prompt
