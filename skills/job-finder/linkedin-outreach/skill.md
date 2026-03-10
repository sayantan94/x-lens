---
name: linkedin-outreach
description: Send personalized connection requests and messages to hiring managers from high-scoring LinkedIn posts. Use when the user wants to reach out, connect, or message people who posted relevant job opportunities. Reads qualified posts from ~/.x-lens/linkedin-posts.jsonl and tracks outreach in ~/.x-lens/linkedin-outreach.jsonl.
triggers: [outreach, reach out, connect, message, send connection, contact recruiter, contact hiring manager, linkedin message, networking]
---

# LinkedIn Outreach

## Instructions

### Step 1: Verify Login
1. Navigate to `https://www.linkedin.com/feed/`
2. Take a screenshot

   - Expected: LinkedIn feed with posts visible, navigation bar showing "Home", "My Network", "Jobs"
   - If feed is visible: you are logged in. Continue to Step 2.
   - If login/signup page is shown: call the `linkedin-login` skill, then return here.

### Step 2: Load Your Profile
1. Read user profile from environment variables using shell:
   ```
   echo "Name: $X_LENS_USER_NAME"
   echo "Title: $X_LENS_USER_TITLE"
   echo "Location: $X_LENS_USER_LOCATION"
   echo "Website: $X_LENS_USER_WEBSITE"
   echo "GitHub: $X_LENS_USER_GITHUB"
   echo "Skills: $X_LENS_USER_SKILLS"
   echo "Experience: $X_LENS_USER_EXPERIENCE"
   echo "LinkedIn: $X_LENS_USER_LINKEDIN"
   ```
2. Store this profile context — you will use it in Step 5b to personalize every outreach message
3. If `X_LENS_USER_LINKEDIN` is set, skip this profile URL during outreach to avoid messaging yourself
4. If the website URL is set, you can reference it in follow-up messages (not the first outreach)

   - Expected: Profile fields populated with the user's background and skills
   - If profile vars are empty: check memory for user info. If still nothing, use generic messages but warn in the summary report that profile should be configured in `.env`

CRITICAL: Use the profile to match your outreach to what the hiring manager is looking for. If they want "distributed systems experience" and your profile includes that, mention it specifically. This is what makes outreach effective — not generic "I'm interested in your role" messages.

### Step 3: Load High-Scoring Posts
1. Check that the posts file exists: `test -f ~/.x-lens/linkedin-posts.jsonl && echo "exists" || echo "missing"`
2. Load posts with relevance score >= 0.7: `cat ~/.x-lens/linkedin-posts.jsonl | while IFS= read -r line; do score=$(echo "$line" | jq -r '.relevanceScore // 0'); if [ "$(echo "$score >= 0.7" | bc -l)" = "1" ]; then echo "$line"; fi; done`
3. Parse each qualifying post — extract: `url`, `author`, `authorTitle`, `company`, `text`, `relevanceScore`, `id`

   - Expected: One or more post objects with score >= 0.7 and valid author/URL fields
   - If file is missing: tell the user to run the linkedin-search and post-ranking skills first
   - If no posts score >= 0.7: report this and suggest lowering the threshold or running a new search

### Step 4: Filter Out Already-Contacted Authors
1. Ensure outreach log exists: `mkdir -p ~/.x-lens && touch ~/.x-lens/linkedin-outreach.jsonl`
2. For each qualifying post, compute the author's profile URL hash: `echo -n "<profileUrl>" | shasum -a 256 | cut -c1-64`
3. Check if this hash exists in the outreach log with a `sentAt` within the last 30 days:
   ```
   grep '"id":"<hash>"' ~/.x-lens/linkedin-outreach.jsonl | jq -r '.sentAt' | while read ts; do
     clean_ts=$(echo "$ts" | sed 's/Z$//' | sed 's/[+-][0-9][0-9]:[0-9][0-9]$//')
     sent_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$clean_ts" "+%s" 2>/dev/null || echo 0)
     now_epoch=$(date "+%s")
     diff=$(( (now_epoch - sent_epoch) / 86400 ))
     if [ "$diff" -lt 30 ]; then echo "SKIP"; break; fi
   done
   ```
   - If output contains "SKIP": skip this author (contacted within 30 days)
   - If no match or older than 30 days: include this author in the outreach list

   - Expected: A filtered list of authors to contact, with recently-contacted ones removed
   - If all authors were already contacted: report this and suggest running a new search

### Step 5: Outreach Loop (Max 10 Per Run)
Process up to 10 authors from the filtered list. For each author:

#### Step 5a: Visit Author Profile
1. Navigate to the author's LinkedIn profile URL
2. Wait 2-3 seconds for the page to load (rate limiting)
3. Take a screenshot
4. Extract from the profile: full name, headline/title, current company, connection status (1st, 2nd, 3rd)

   - Expected: Profile page loaded with visible name, title, and Connect or Message button
   - If profile is unavailable or private: skip this author, log as skipped

#### Step 5b: Draft Message
Compose a personalized message using the user's profile (from Step 2) and the post context:

- **Connection request note** (not yet connected): max **300 characters** hard limit. Reference their specific post, mention a matching skill from the user's profile.
- **Direct message** (already connected): max **500 characters**. Reference the post, highlight relevant experience from the user's profile.

**Personalization using profile:** Match the user's skills/experience to what the post is looking for. If the post says "distributed systems" and the user's profile includes that, mention it. If the post mentions a specific tech stack the user knows, reference it. This is what makes outreach convert — specific skill matches, not generic interest.

Message rules:
- You are acting as an Executive Assistant (EA) for the user — always use the framing "I'm an EA for {user_name}"
- Never pretend to be the user — you are their EA
- Always reference the specific post that triggered the outreach
- Match at least one skill/experience from the user's profile to the role
- MANDATORY: Always include both the user's website (X_LENS_USER_WEBSITE) and GitHub (X_LENS_USER_GITHUB) in every single message — connection requests, DMs, follow-ups, everything. No exceptions. Use compact format "{website} | {github}" to save characters.
- Conversational tone — professional but not corporate
- Never say "Dear", "I believe they'd be a strong fit", or any corporate-speak
- One ask per message
- No attachments or resume links in the first message

See `references/message-templates.md` for template patterns.

   - Expected: A draft message under the character limit, referencing the specific post
   - If the post text is too vague to reference: use the author's headline/title as context instead

#### Step 5c: Send Message
Based on connection status:

**If not connected:**
1. Click the "Connect" button on their profile
2. Click "Add a note" in the dialog
3. Paste the connection request note (verify it's under 300 characters)
4. Click "Send"
5. Take a screenshot to confirm

**If already connected:**
1. Click the "Message" button on their profile
2. Type the direct message in the message box
3. Click "Send"
4. Take a screenshot to confirm

   - Expected: Confirmation that the message or connection request was sent
   - If LinkedIn shows "You've reached the weekly invitation limit": **STOP all outreach immediately**. Do not attempt any more connection requests. Log the rate limit event and proceed directly to Step 6.
   - If no "Connect" button is visible: they may have disabled invitations or you have a pending request. Skip this author, log as skipped.

CRITICAL: Stop immediately on ANY LinkedIn rate limit warning, security challenge, or CAPTCHA. Do not retry. Proceed to Step 6 and report the issue.

#### Step 5d: Log Outreach
For each successful outreach, append a record to `~/.x-lens/linkedin-outreach.jsonl`:

1. Generate ID: `echo -n "<profileUrl>" | shasum -a 256 | cut -c1-64`
2. Append: `echo '<json_line>' >> ~/.x-lens/linkedin-outreach.jsonl`

**JSONL record fields:**
- `id`: SHA-256 hash of profileUrl (full 64 chars)
- `profileUrl`: the author's LinkedIn profile URL
- `name`: author's full name
- `title`: author's headline/title
- `postUrl`: URL of the post that triggered outreach
- `messageType`: `"connection_request"` or `"direct_message"`
- `messageSent`: the exact message text sent
- `sentAt`: ISO 8601 timestamp
- `sourcePostId`: the `id` field from the original post in linkedin-posts.jsonl

   - Expected: One JSONL line appended per successful outreach

### Step 6: Summary Report
Present a report with:

1. **Totals**: authors in queue, outreach sent, skipped (with reasons)
2. **Sent list**: for each sent message — name, title, company, message type, post referenced
3. **Skipped list**: for each skipped author — name, reason (already contacted, no Connect button, profile unavailable)
4. **Rate limit status**: whether LinkedIn showed any rate limit warnings, how many invitations were sent this run

   - Expected: Concise report the user can scan in under 30 seconds
   - If 0 messages were sent: explain why and suggest next steps

## Performance Notes
- Maximum 10 outreach actions per run — never exceed this to avoid LinkedIn throttling
- LinkedIn's weekly invitation limit is approximately 100. The daemon targets ~50/week to stay well under the cap.
- Wait 2-3 seconds between profile visits to mimic human browsing patterns
- Connection request notes have a **300 character hard limit** enforced by LinkedIn — truncation will cause send failure
- Direct messages can be up to 500 characters for first contact — keep them concise
- The outreach log dedup uses SHA-256 of the profile URL, not the post URL, so one author is only contacted once per 30-day window regardless of how many qualifying posts they have

## Examples

### Example 1: Connection request to hiring manager
User says: "Reach out to people from the top ranked posts"

Post found (score 0.82): Jane Smith, Engineering Manager at Stripe — "We're expanding the payments platform team! Looking for senior backend engineers who love distributed systems. Seattle or remote."

1. Visit Jane's profile — status: 2nd connection
2. Draft note (287 chars): "Hi Jane, saw your post about growing the payments platform team at Stripe — sounds like a great challenge. I've been working on distributed systems for the past few years and would love to learn more. Would be great to connect!"
3. Click Connect > Add a note > paste > Send
4. Log: `{"id":"a1b2c3...","profileUrl":"https://linkedin.com/in/janesmith","name":"Jane Smith","title":"Engineering Manager at Stripe","postUrl":"https://linkedin.com/feed/update/urn:li:activity:123","messageType":"connection_request","messageSent":"Hi Jane, saw your post about...","sentAt":"2026-03-09T14:30:00Z","sourcePostId":"d4e5f6..."}`

### Example 2: DM to existing connection
Post found (score 0.91): Bob Lee, Staff Engineer at Datadog — "My team just got headcount for 2 senior engineers. We work on the metrics pipeline — billions of data points/day. DM me if interested."

1. Visit Bob's profile — status: 1st connection
2. Draft DM (342 chars): "Hey Bob, saw your post about the metrics pipeline openings at Datadog — billions of data points sounds like exactly the kind of scale I enjoy working on. I've been doing similar work with high-throughput data systems. Would love to hear more about the team and what you're looking for."
3. Click Message > type > Send
4. Log with `messageType: "direct_message"`

### Example 3: Invitation limit reached
Processing author 4 of 8. Click Connect on Sarah Chen's profile.

LinkedIn shows: "You've reached the weekly invitation limit."

1. **STOP immediately** — do not attempt authors 5-8
2. Log Sarah as skipped with reason "weekly_invitation_limit"
3. Summary report:
```
## LinkedIn Outreach Summary

**Sent:** 3 | **Skipped:** 5 (1 rate limited, 4 not attempted)

### Sent
1. Jane Smith (Eng Manager, Stripe) — connection request — re: payments platform post
2. Bob Lee (Staff Eng, Datadog) — direct message — re: metrics pipeline post
3. Alice Wang (Recruiter, Meta) — connection request — re: backend hiring post

### Skipped
4. Sarah Chen — weekly invitation limit reached
5-8. Not attempted (stopped due to rate limit)

### Rate Limit Status
LinkedIn weekly invitation limit reached. Wait until next week before sending more connection requests. Direct messages to existing connections are unaffected.
```

## Troubleshooting

### No "Connect" button on profile
Cause: You may already have a pending invitation, or the person has disabled connection requests
Solution: Skip this author and log as skipped with reason "no_connect_button". Check if a "Message" button is available instead (they may have open messaging enabled).

### CAPTCHA or security challenge
Cause: LinkedIn detected automated behavior
Solution: **STOP all outreach immediately.** Do not attempt to solve the CAPTCHA. Report the issue to the user. Wait at least 24 hours before attempting outreach again. Consider reducing outreach frequency.

### Duplicate entries in outreach log
Cause: The dedup check in Step 3 failed or was skipped
Solution: Deduplicate by ID: `jq -s 'unique_by(.id)[]' ~/.x-lens/linkedin-outreach.jsonl > /tmp/deduped.jsonl && mv /tmp/deduped.jsonl ~/.x-lens/linkedin-outreach.jsonl`

### Missing profile URL in post data
Cause: Post extraction didn't capture the author's profile link
Solution: Try to find the author by searching LinkedIn: navigate to `https://www.linkedin.com/search/results/people/?keywords=<author name + company>`. If found, use that profile URL. If not found, skip this author and log as skipped with reason "profile_url_missing".
