---
name: post-ranking
description: Score and rank LinkedIn hiring posts by relevance to job search criteria. Use when extracted posts need filtering and saving. Scores on direct hiring signal, seniority match, location, company fit, and recency. Saves qualifying posts to ~/.x-lens/linkedin-posts.jsonl.
triggers: [rank posts, score posts, analyze posts, relevance, ranking, filter jobs, rate posts]
---

# Post Ranking

## Instructions

### Step 1: Gather Inputs
1. Read the user's original search prompt to identify: target role, seniority level, preferred location, target companies or company types
2. Load extracted posts from the previous `linkedin-search` / `post-extraction` step

   - Expected: Clear search criteria (role, seniority, location) and an array of post objects
   - If search criteria are vague: infer reasonable defaults (e.g., no location = score all locations at 0.5)

### Step 2: Score Each Post (0.0 to 1.0)
Apply five weighted criteria to each post. See `references/scoring-rubric.md` for detailed signal tables.

| Criterion | Weight | Key signals |
|-----------|--------|-------------|
| Direct hiring post | 0.30 | "we're hiring", "join my team", job requirements listed |
| Seniority match | 0.25 | Exact match=1.0, adjacent=0.7, not mentioned=0.5 |
| Location match | 0.20 | Exact city=1.0, same state=0.8, remote=0.7 |
| Company match | 0.15 | Named company=1.0, category match=0.7 |
| Recency | 0.10 | Today=1.0, this week=0.6, older=0.1-0.3 |

**Formula**: `score = (hiring * 0.30) + (seniority * 0.25) + (location * 0.20) + (company * 0.15) + (recency * 0.10)`

   - Expected: Each post has a `relevanceScore` between 0.0 and 1.0, plus a `rankingReason` string explaining the score
   - If a field is missing from a post (e.g., no location mentioned): score that criterion conservatively at 0.5

CRITICAL: Always provide a `rankingReason` string for each post explaining which criteria scored high or low. This is essential for the summary report.

### Step 3: Filter by Score
Categorize posts into three buckets:

1. **Below 0.3**: discard — not relevant enough to save
2. **0.3 to 0.5**: save as `"low confidence"` — marginally relevant
3. **Above 0.5**: save as `"relevant match"` — strong alignment with search criteria

   - Expected: Posts split into discard, low confidence, and relevant match groups
   - If all posts score below 0.3: report this — search queries may have been too broad

### Step 4: Save to JSONL
For each qualifying post (score >= 0.3):

1. Ensure file exists: `mkdir -p ~/.x-lens && touch ~/.x-lens/linkedin-posts.jsonl`
2. Generate ID: `echo -n "<url>" | shasum -a 256 | cut -c1-16`
3. Check for duplicates: `grep -c '"id":"<hash>"' ~/.x-lens/linkedin-posts.jsonl`
   - If count > 0: skip this post (already saved)
4. Append JSONL record: `echo '<json_line>' >> ~/.x-lens/linkedin-posts.jsonl`

   - Expected: New posts appended to `~/.x-lens/linkedin-posts.jsonl`, duplicates skipped

**JSONL record fields**: id, url, author, authorTitle, company, text (first 500 chars), postedAt, capturedAt (ISO 8601), searchQuery, sourcePrompt, relevanceScore, rankingReason, seniority, location

### Step 5: Summary Report
Present a report with:

1. **Totals**: posts analyzed, discarded, saved (low confidence count + relevant match count)
2. **Top 3 posts**: with scores, authors, companies, and ranking reasons
3. **Issues**: any scoring anomalies, missing data, or suggestions for better queries

   - Expected: Concise report the user can scan in under 30 seconds
   - If 0 posts were saved: include a suggestion to refine search queries

## Performance Notes
- Score all posts before filtering — batch processing is faster than score-then-filter per post
- The JSONL dedup check via `grep` is fast for files under 10,000 lines. For very large files, report the file size with `wc -l`
- Recency scoring relies on LinkedIn's relative timestamps ("2d", "1w"). Parse these as approximate values, not exact dates

## Examples

### Example 1: High relevance post
User says: "Find senior backend engineer roles at FAANG in Seattle"

Post: "We're hiring a Senior Backend Engineer at Google! Seattle office, hybrid. Requirements: 5+ yrs distributed systems..."
- Hiring signal: 1.0 (explicit "we're hiring" + requirements listed)
- Seniority: 1.0 (exact "Senior" match)
- Location: 1.0 (exact "Seattle" match)
- Company: 1.0 (Google is FAANG)
- Recency: 0.8 (posted yesterday)

Score: `(1.0 * 0.30) + (1.0 * 0.25) + (1.0 * 0.20) + (1.0 * 0.15) + (0.8 * 0.10)` = **0.98**

Result: Saved as relevant match

### Example 2: Low relevance post (discarded)
User says: "Find senior backend engineer roles at FAANG in Seattle"

Post: "Excited to share my thoughts on the future of engineering careers! The industry is evolving fast..."
- Hiring signal: 0.1 (no hiring language, generic career commentary)
- Seniority: 0.5 (not mentioned)
- Location: 0.3 (no location)
- Company: 0.2 (no company)
- Recency: 0.6 (this week)

Score: `(0.1 * 0.30) + (0.5 * 0.25) + (0.3 * 0.20) + (0.2 * 0.15) + (0.6 * 0.10)` = **0.30**

Result: Borderline — saved as low confidence

### Example 3: Summary report output
```
## LinkedIn Post Ranking Summary

**Analyzed:** 47 posts | **Discarded:** 28 | **Saved:** 19 (7 low confidence, 12 relevant)

### Top 3 Posts
1. **Score 0.98** — Jane Smith (Google) — "We're hiring Senior Backend Engineer, Seattle"
   Reason: Direct hiring, exact seniority/location/company match, posted yesterday
2. **Score 0.85** — Bob Lee (Meta) — "Join my team! Backend engineers, Bellevue/remote"
   Reason: Strong hiring signal, adjacent location, FAANG match
3. **Score 0.72** — Recruiter at Amazon — "Open roles: SDE II/III, Seattle"
   Reason: Hiring signal, location match, adjacent seniority (SDE III ≈ senior)

No issues detected.
```

## Troubleshooting

### All posts score below 0.3
Cause: Search queries were too broad and returned mostly irrelevant content (career advice, motivational posts)
Solution: Suggest more specific queries with explicit hiring language. Add "hiring" or "open role" to queries. Include target company names.

### JSONL file doesn't exist
Cause: First run, file hasn't been created yet
Solution: Run `mkdir -p ~/.x-lens && touch ~/.x-lens/linkedin-posts.jsonl` before attempting to append.

### Duplicate post IDs in JSONL
Cause: Same post saved from a previous run
Solution: The `grep` dedup check in Step 4 prevents this. If duplicates exist from before the check was added, deduplicate manually: `sort -u -t'"' -k4,4 ~/.x-lens/linkedin-posts.jsonl > /tmp/deduped.jsonl && mv /tmp/deduped.jsonl ~/.x-lens/linkedin-posts.jsonl`

### Missing fields in extracted posts
Cause: Post extraction returned incomplete data (e.g., no URL, no authorTitle)
Solution: Score conservatively — set the missing criterion's contribution to 0.5. Generate ID from author + text hash if URL is missing.
