---
name: linkedin-search
description: Decompose natural language job search prompts into LinkedIn content search queries and extract hiring posts. Use when user says "find hiring posts", "search LinkedIn for jobs", "who is hiring", or "find me roles at". Generates multiple search queries, navigates LinkedIn, scrolls through results, and extracts post data.
triggers: [linkedin, job search, hiring posts, find jobs, who is hiring, linkedin posts, recruiting, job openings]
---

# LinkedIn Search

## Instructions

### Step 1: Verify Login
1. Navigate to `https://www.linkedin.com/feed/`
2. Take a screenshot
   - Expected: LinkedIn feed with posts, navigation bar showing "Home", "My Network"
3. If you see a login/signup page instead, load the `linkedin-login` skill via `skill_read` and follow it before continuing

### Step 2: Decompose Prompt into Queries
Take the user's natural language prompt and generate **5-10 diverse search queries**. Cover these angles:

- **Role-focused**: exact title + "hiring" → `senior backend engineer hiring`
- **Company-focused**: company name/type + role → `Google hiring backend engineer`
- **Location-focused**: city + role + "open role" → `NYC backend engineer open role`
- **Hashtag-based**: `#hiring senior engineer`, `#opentowork backend`
- **Synonym variations**: alternate job titles → `platform engineer`, `server-side developer`
- **Recruiter phrases**: "looking for", "join my team", "we're hiring" + role

CRITICAL: More specific queries yield better results than broad ones. Always include the target seniority level and location in at least 3 queries.

### Step 3: Execute Each Search
For each query:
1. URL-encode the query string
2. Navigate to `https://www.linkedin.com/search/results/content/?keywords=<ENCODED_QUERY>&sortBy=date_posted`
3. Take a screenshot to verify results loaded
   - Expected: List of LinkedIn posts matching the search
   - If empty or error page: skip this query, move to next
4. Pause 2-3 seconds before the next query to avoid rate limiting

### Step 4: Scroll and Extract Posts
For each search results page, perform **3 rounds** of scroll-and-extract:

1. **Scroll**: Use `browser_scroll` down 800px, repeat 3-5 times. Wait 1-2 seconds between scrolls for content to lazy-load.
2. **Extract**: Run JavaScript via `browser_evaluate` to pull post data from the DOM. Consult `references/extraction-selectors.md` for the extraction script and selector strategies.
   - Expected: JSON array of post objects with author, authorTitle, company, text, url, postedAt
   - If extraction returns 0 posts: take a screenshot, inspect the DOM classes, and adjust selectors. Save working selectors to memory for future runs.
3. **Deduplicate**: Compare new posts against already-collected ones by URL
4. **Stop condition**: If a round yields zero new posts, stop scrolling for this query

### Step 5: Click Into Posts for Details
For each extracted post that looks like a hiring post (has hiring keywords in text):

1. Click on the post to open its detail/permalink view
2. Wait 2 seconds for the page to load
3. Capture the **actual LinkedIn post URL** from the browser's address bar (`window.location.href`)
   - Expected: URL like `https://www.linkedin.com/feed/update/urn:li:activity:...`
   - This is the real permalink — update the post's `url` field with it
4. Optionally extract fuller post text from the detail view if the search result snippet was truncated
5. Navigate back to the search results page
6. Pause 1-2 seconds before the next click

CRITICAL: The search results page often does NOT include the actual LinkedIn post URL — it may show job listing links instead. You MUST click into the post to get the real LinkedIn permalink. Without this, the "View on LinkedIn" link in the jobs UI will be broken.

   - If clicking a post opens a modal/overlay instead of a new page: extract the URL from the modal's share button or the overlay's URL
   - If the page changes away from search results: use browser back navigation to return

### Step 6: Compile and Hand Off
1. Merge posts from all queries
2. Deduplicate across queries by URL (or by author + first 100 chars of text if no URL)
3. Sort by recency (most recent first)
4. Load the `post-ranking` skill via `skill_read` to score and save results

## Performance Notes
- Take your time with each query — quality extraction matters more than speed
- Do not skip the screenshot verification steps
- If a query returns poor results, adjust wording rather than moving on

## Examples

### Example 1: Targeted role search
User says: "Find senior backend engineer roles at FAANG companies in Seattle"

Actions:
1. Generate queries: "senior backend engineer hiring Amazon Seattle", "Google Seattle engineering team hiring", "#hiring senior engineer Seattle FAANG", "Meta backend engineer open role Seattle", "we're hiring staff engineer Amazon"
2. Execute 5 searches on LinkedIn content
3. Scroll and extract ~15 posts per search
4. Click into top hiring posts to capture LinkedIn permalinks
5. Deduplicate across all results

Result: 47 unique posts with LinkedIn permalinks, passed to post-ranking skill

### Example 2: Broad industry search
User says: "Any AI startups hiring ML engineers in SF?"

Actions:
1. Generate queries: "AI startup hiring ML engineer San Francisco", "machine learning engineer startup SF", "#hiring ML engineer Bay Area", "join my team AI engineer San Francisco"
2. Execute 4 searches, extract posts
3. Click into each post to get real LinkedIn URL

Result: 23 unique posts with permalinks extracted

## Troubleshooting

### Zero results from extraction
Cause: LinkedIn changed their DOM class names (happens frequently)
Solution: Take a screenshot. Use `browser_evaluate` to inspect: `document.querySelector('.feed-shared-update-v2')?.innerHTML?.slice(0, 500)`. Update selectors in `references/extraction-selectors.md`. Save working selectors to memory.

### LinkedIn shows login page mid-search
Cause: Session cookie expired during the search run
Solution: Load and follow the `linkedin-login` skill. Then resume remaining queries.

### Rate limited (empty results after several queries)
Cause: Too many searches in quick succession
Solution: Pause 30 seconds between remaining queries. On next run, reduce to 3-5 queries and increase pause to 5 seconds.

### Search returns mostly irrelevant content
Cause: Queries too broad
Solution: Add quotes around exact phrases. Always include "hiring" or "open role". Make queries more specific to role + location + company.
