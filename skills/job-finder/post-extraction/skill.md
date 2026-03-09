---
name: post-extraction
description: Extract structured data from LinkedIn post DOM elements using cascading selector strategies. Use when LinkedIn posts need parsing into structured JSON. Handles multiple DOM layouts, company parsing, deduplication, and error recovery.
triggers: [extract posts, parse linkedin, post data, dom extraction, scrape posts]
---

# Post Extraction

## Instructions

### Step 1: Run Selector Strategies in Order
Execute JavaScript via `browser_evaluate` using cascading strategies. Use the first that returns results. See `references/dom-selectors.md` for complete JavaScript code.

1. **Strategy 1**: `[data-urn*="urn:li:activity"]` — standard feed pages
2. **Strategy 2**: `.feed-shared-update-v2` — older feed layout
3. **Strategy 3**: `.reusable-search__result-container` — search result pages

   - Expected: JSON string of post objects with fields: author, authorTitle, text, url, postedAt
   - If Strategy 1 returns 0 results: try Strategy 2
   - If Strategy 2 returns 0 results: try Strategy 3
   - If all 3 return 0 results: proceed to Step 4 (Error Recovery)

CRITICAL: Parse the returned JSON string and validate it is a non-empty array before proceeding.

### Step 2: Parse Company from Author Title
Extract company name from the `authorTitle` field using separator patterns. Apply the first matching pattern:

1. `"Role at Company"` → split on ` at `, take right side
2. `"Company | Role"` → split on ` | `, take the non-job-title side
3. `"Company - Role"` → split on ` - `, take the non-job-title side
4. `"Role, Company"` → split on `, `, take the non-job-title side

Job-title indicator words: Engineer, Manager, Director, Lead, Developer, VP, Head, Founder, CEO, CTO

   - Expected: Each post object now has a `company` field (string or empty)
   - If no separator pattern matches: set `company` to empty string

### Step 3: Deduplicate
Remove duplicate posts using two strategies:

1. **By URL**: if two posts share the same non-empty URL, keep only the first occurrence
2. **By content**: if a post has no URL, match on `author + first 100 chars of text`

   - Expected: Array with fewer or equal items than input
   - If no duplicates found: original array passes through unchanged

### Step 4: Error Recovery
If all three strategies in Step 1 returned 0 posts:

1. Take a screenshot to diagnose the page state
   - Expected: Screenshot showing either posts (selector issue) or empty/error page
2. Try the article fallback: `document.querySelectorAll('article')` (see `references/dom-selectors.md`)
   - Expected: Raw text from article elements, less structured but non-zero
3. If fallback returns 0: wait 2 seconds, retry Strategy 1
   - Expected: Lazy-loaded content now present
4. If still empty: report failure with screenshot — page may need login or LinkedIn changed their DOM

CRITICAL: Do not silently return 0 posts. Always report the failure with a screenshot so the issue can be diagnosed.

## Output Format
JSON array of post objects:
```json
[{"author": "Jane Smith", "authorTitle": "Eng Manager at Google", "company": "Google", "text": "We're hiring...", "url": "https://linkedin.com/feed/update/...", "postedAt": "2d"}]
```

## Performance Notes
- Strategy 1 works on ~80% of LinkedIn pages — try it first to avoid unnecessary DOM queries
- Each `browser_evaluate` call takes 1-3 seconds — don't run all strategies if the first one succeeds
- Text is capped at 1000 chars per post in the extraction scripts to avoid memory issues
- Filter out posts with `text.length < 10` as they are image/video-only and not useful for job search

## Examples

### Example 1: Feed page extraction
User says: "Extract posts from this LinkedIn feed page"

Actions:
1. Run Strategy 1 (`[data-urn*="urn:li:activity"]`) via `browser_evaluate`
2. Returns 12 post objects as JSON
3. Parse company from authorTitle: 10 matched patterns, 2 left empty
4. Deduplicate by URL: 2 duplicates removed

Result: 10 unique posts with author, company, text, URL, and timestamp

### Example 2: Search results page extraction
User says: "Extract posts from LinkedIn search results"

Actions:
1. Run Strategy 1 → returns 0 results (search page uses different DOM)
2. Run Strategy 2 → returns 0 results
3. Run Strategy 3 (`.reusable-search__result-container`) → returns 8 posts
4. Parse company, deduplicate

Result: 8 unique posts extracted from search results layout

### Example 3: DOM structure changed
User says: "Extract posts" but all strategies return 0

Actions:
1. All 3 strategies return 0 posts
2. Screenshot shows posts are visible on page
3. Try article fallback → returns 5 raw text blocks
4. Report: "Primary selectors broken, used article fallback. Update `references/dom-selectors.md` with new selectors."

Result: 5 posts extracted via fallback, selectors flagged for update

## Troubleshooting

### All strategies return 0 posts
Cause: LinkedIn changed their DOM class names (happens frequently)
Solution: Take a screenshot. Use `browser_evaluate` to inspect: `document.querySelector('.feed-shared-update-v2')?.innerHTML?.slice(0, 500)`. Compare visible class names against selectors in `references/dom-selectors.md`. Update the reference file with working selectors. Save working selectors to memory for future runs.

### Posts missing text field
Cause: Some posts are image-only or video-only with no text content
Solution: Filter out posts where `text.length < 10`. These are not useful for job search analysis.

### "Cannot read property" errors in JavaScript
Cause: DOM structure changed and a property access path is broken
Solution: All extraction scripts in `references/dom-selectors.md` wrap property access in try/catch. If errors persist, inspect the DOM manually and update the selector chains.

### Duplicate posts across multiple queries
Cause: Same post appears in results for different search queries
Solution: Expected behavior. Step 3 deduplication handles this. The `linkedin-search` skill also deduplicates across queries after all extraction is complete.
