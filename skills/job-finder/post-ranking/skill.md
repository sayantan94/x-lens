---
name: post-ranking
description: Analyze and rank LinkedIn hiring posts by relevance, seniority match, location, and company fit
triggers: [rank posts, score posts, analyze posts, relevance, ranking]
---

## Instructions

This skill takes a collection of extracted LinkedIn posts (from memory or prior search results) and scores each post on how relevant it is to the user's job search criteria. Posts are ranked, filtered by confidence, deduplicated, and saved to `~/.x-lens/linkedin-posts.jsonl`.

### Step 1: Gather Inputs

1. Read the user's original search prompt to understand their target role, seniority, location, and company preferences.
2. Use `memory_read` with key `linkedin_search_results` to retrieve all extracted posts from the linkedin-search skill.
3. If no posts are in memory, ask the user to run the `linkedin-search` skill first.

### Step 2: Score Each Post

Evaluate every post against five weighted criteria. Each criterion produces a score from **0.0 to 1.0**, and the final relevance score is the weighted sum.

#### 2a. Direct Hiring Post (weight: 0.30)

Determine whether the post is an actual hiring announcement or just tangentially related content.

| Signal | Score |
|--------|-------|
| Phrases like "we're hiring", "join my team", "open role", "looking for a", "come work with us" | 0.8 – 1.0 |
| Job description details (requirements, qualifications, how to apply) | 0.9 – 1.0 |
| Author is a recruiter or hiring manager (check headline) | 0.7 – 0.9 |
| Generic career advice, motivational content, or industry commentary | 0.1 – 0.3 |
| Reshare of someone else's post with no added hiring context | 0.0 – 0.2 |

#### 2b. Seniority Match (weight: 0.25)

Compare the role level mentioned in the post against the user's target seniority.

| Match Quality | Score |
|---------------|-------|
| Exact match (e.g., user wants "senior", post says "senior") | 1.0 |
| Adjacent level (e.g., user wants "senior", post says "staff" or "mid-level") | 0.7 |
| Seniority not mentioned in the post | 0.5 |
| Wrong level entirely (e.g., user wants "senior", post says "intern" or "VP") | 0.2 |

#### 2c. Location Match (weight: 0.20)

Compare the post's location information against the user's preferred location.

| Match Quality | Score |
|---------------|-------|
| Exact city match | 1.0 |
| Same state or metro area | 0.8 |
| Remote or hybrid mentioned | 0.7 |
| Country match only | 0.5 |
| No location mentioned | 0.3 |
| Explicitly a different city/country with no remote option | 0.1 |

#### 2d. Company Match (weight: 0.15)

Check if the post's company aligns with the user's stated company preferences (specific companies, company types, industries, or size).

| Match Quality | Score |
|---------------|-------|
| Named company the user specifically requested | 1.0 |
| Company matches a stated category (e.g., "startup", "FAANG", "fintech") | 0.7 |
| Company identifiable but no match to user preferences | 0.4 |
| No company information available | 0.2 |

#### 2e. Recency (weight: 0.10)

How recently the post was published.

| Recency | Score |
|---------|-------|
| Today | 1.0 |
| Yesterday | 0.8 |
| This week (2-7 days) | 0.6 |
| Last week (8-14 days) | 0.3 |
| Older than 2 weeks | 0.1 |

#### Final Score Calculation

```
relevanceScore = (directHiring * 0.30) + (seniorityMatch * 0.25) + (locationMatch * 0.20) + (companyMatch * 0.15) + (recency * 0.10)
```

Round the final score to two decimal places.

### Step 3: Filter by Confidence Threshold

After scoring all posts, classify each one:

| Score Range | Action |
|-------------|--------|
| Below 0.3 | **Discard** — not relevant enough to save |
| 0.3 – 0.5 | **Save as low confidence** — might be useful but unlikely |
| Above 0.5 | **Save as relevant** — strong match worth reviewing |

### Step 4: Prepare JSONL Records

For each post that passes the filter (score >= 0.3), construct a JSON record. Each line in the JSONL file is a single JSON object:

```json
{"id":"sha256-of-url","url":"https://linkedin.com/feed/update/...","author":"Jane Smith","authorTitle":"Engineering Manager at Acme","company":"Acme Corp","text":"We're hiring a senior backend engineer...","postedAt":"2026-03-07","capturedAt":"2026-03-08T14:30:00Z","searchQuery":"senior backend engineer hiring","sourcePrompt":"find me senior backend roles in Seattle","relevanceScore":0.85,"rankingReason":"Direct hiring post from engineering manager, exact seniority match, Seattle location, known company","seniority":"senior","location":"Seattle"}
```

**Field definitions:**

- `id`: SHA-256 hash of the post URL, truncated to 16 characters. Generate using `echo -n "<url>" | shasum -a 256 | cut -c1-16`.
- `url`: The LinkedIn post URL.
- `author`: Name of the post author.
- `authorTitle`: The author's LinkedIn headline.
- `company`: Company name extracted from the post or author headline. Use `"unknown"` if not identifiable.
- `text`: First 500 characters of the post content.
- `postedAt`: When the post was published (best estimate from the relative timestamp).
- `capturedAt`: ISO 8601 timestamp of when the post was captured (now).
- `searchQuery`: The LinkedIn search query that surfaced this post.
- `sourcePrompt`: The user's original natural language prompt.
- `relevanceScore`: The calculated weighted score (0.0 to 1.0).
- `rankingReason`: A brief human-readable explanation of why this score was given.
- `seniority`: The seniority level detected in the post (e.g., "junior", "mid", "senior", "staff", "lead", "manager", "unknown").
- `location`: The location mentioned in the post, or `"unknown"`.

### Step 5: Deduplicate Before Saving

Before appending each record to the JSONL file, check if a record with the same ID already exists:

```bash
grep -c '"id":"<hash>"' ~/.x-lens/linkedin-posts.jsonl
```

- If the count is **greater than 0**, skip that record (already saved).
- If the file does not exist yet, create it with `touch ~/.x-lens/linkedin-posts.jsonl`.

Use the shell tool to run dedup checks and append records:

```bash
echo '<json-line>' >> ~/.x-lens/linkedin-posts.jsonl
```

### Step 6: Summary Report

After processing all posts, present a summary to the user:

```
### Post Ranking Summary

**Source prompt**: "<user's original prompt>"
**Total posts analyzed**: <N>
**Discarded (score < 0.3)**: <X>
**Saved as low confidence (0.3–0.5)**: <Y>
**Saved as relevant (> 0.5)**: <Z>

#### Top 3 Posts

1. **[Author]** at **[Company]** — Score: [0.XX]
   [First 150 chars of post text]...
   Reason: [rankingReason]
   Link: [url]

2. ...

3. ...

#### Issues
- [Any posts that couldn't be scored due to missing data]
- [Any duplicates skipped]
- [Any errors encountered]
```

### Important Notes

- **Score transparency**: Always include the `rankingReason` field so the user understands why a post was ranked the way it was. This is critical for trust and for refining future searches.
- **Conservative scoring**: When in doubt, score lower. It is better to surface fewer high-quality leads than to flood the user with noise.
- **Missing data handling**: If a post is missing critical fields (e.g., no text content), assign it a score of 0.0 and discard it. Do not guess or fabricate information.
- **File safety**: Always ensure `~/.x-lens/` directory exists before writing. Use `mkdir -p ~/.x-lens` if needed.
- **Incremental operation**: This skill is designed to be run multiple times. Each run appends new posts and skips duplicates, building up the JSONL file over time.
