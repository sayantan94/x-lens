---
name: linkedin-search
description: Decompose natural language job search prompts into LinkedIn content search queries and extract relevant posts
source: x-lens
triggers: [linkedin, job search, hiring, who is hiring, job posts, linkedin search, job openings, recruiting]
---

## Instructions

This skill takes a natural language job search prompt (e.g., "find me senior backend engineer roles at startups in NYC") and decomposes it into multiple LinkedIn content search queries to find relevant hiring posts.

### Step 1: Check LinkedIn Login

1. Use `browser_navigate` to go to `https://www.linkedin.com/feed/`
2. Use `browser_screenshot` to check the current page
3. If you see a login/signup page instead of the feed, invoke the `linkedin-login` skill via `skill_read` and follow its instructions before continuing
4. Once logged in, proceed to Step 2

### Step 2: Decompose the Prompt into Search Queries

Take the user's natural language prompt and generate **5-10 diverse search queries** that maximize coverage. Use different angles:

- **Role-focused**: The exact job title + "hiring" (e.g., `senior backend engineer hiring`)
- **Company-type focused**: Company descriptor + role (e.g., `startup hiring backend engineer`)
- **Location-focused**: City/region + role + "open role" (e.g., `NYC backend engineer open role`)
- **Hashtag-based**: Common LinkedIn hiring hashtags (e.g., `#hiring backend engineer`, `#opentowork senior engineer`)
- **Synonym variations**: Alternate job titles (e.g., `server-side developer`, `platform engineer`)
- **Recruiter-style**: Phrases recruiters use (e.g., `looking for backend engineer`, `we're hiring engineers`)
- **Industry-specific**: Domain + role (e.g., `fintech backend engineer hiring`)

Store the generated queries in memory using `memory_write` with key `linkedin_search_queries` so they can be referenced later.

### Step 3: Execute Each Search Query

For each query, perform a LinkedIn content search:

1. URL-encode the query string
2. Use `browser_navigate` to go to:
   ```
   https://www.linkedin.com/search/results/content/?keywords=<URL_ENCODED_QUERY>&sortBy=date_posted
   ```
3. Wait for the page to load, then use `browser_screenshot` to verify results appeared

### Step 4: Scroll and Extract Posts

For each search query page, perform **3 rounds** of scroll-and-extract:

#### Scrolling Strategy
- Use `browser_scroll` to scroll down by **800 pixels** per scroll
- After each scroll, wait briefly for content to lazy-load
- Perform **3-5 scrolls** per round before extracting

#### Post Extraction
After scrolling, use `browser_evaluate` to run JavaScript that extracts post data from the DOM:

```javascript
(() => {
  // NOTE: LinkedIn DOM selectors change frequently. If these selectors
  // return empty results, take a browser_screenshot and inspect the
  // actual class names on the page, then adjust accordingly.
  const posts = document.querySelectorAll('.feed-shared-update-v2');
  const results = [];
  posts.forEach(post => {
    try {
      // Author info
      const authorEl = post.querySelector('.update-components-actor__name span[aria-hidden="true"]');
      const author = authorEl ? authorEl.innerText.trim() : 'Unknown';

      // Author headline / subtitle
      const headlineEl = post.querySelector('.update-components-actor__description span[aria-hidden="true"]');
      const headline = headlineEl ? headlineEl.innerText.trim() : '';

      // Post text content
      const textEl = post.querySelector('.feed-shared-update-v2__description, .update-components-text');
      const text = textEl ? textEl.innerText.trim().substring(0, 500) : '';

      // Timestamp
      const timeEl = post.querySelector('.update-components-actor__sub-description span[aria-hidden="true"]');
      const time = timeEl ? timeEl.innerText.trim() : '';

      // Post link
      const linkEl = post.querySelector('a.app-aware-link[href*="/feed/update/"]');
      const link = linkEl ? linkEl.href.split('?')[0] : '';

      if (text.length > 20) {
        results.push({ author, headline, text, time, link });
      }
    } catch (e) {}
  });
  return JSON.stringify(results);
})()
```

#### Pagination / Deduplication
- After each round, compare newly extracted posts against previously collected ones (by post link or text content)
- If a round yields **zero new posts**, stop scrolling for that query and move to the next
- Use `memory_append` with key `linkedin_search_results` to accumulate all unique posts

### Step 5: Compile and Summarize Results

After all queries are exhausted:

1. Use `memory_read` with key `linkedin_search_results` to retrieve all collected posts
2. Deduplicate by post link or by matching first 100 characters of text
3. Sort by recency (most recent first)
4. Present results to the user in a structured format:

```
### LinkedIn Job Search Results

**Query**: "<original user prompt>"
**Searches executed**: <N> queries
**Posts found**: <M> unique posts

---

#### 1. [Author Name] - [Headline]
**Posted**: [time]
**Content**: [first 300 chars of post text]...
**Link**: [post URL]

---
```

### Important Notes

- **Rate limiting**: Add a short pause between queries. Do not fire all searches in rapid succession. Navigate to each URL one at a time.
- **DOM selector fragility**: LinkedIn frequently changes its CSS class names. If the extraction JavaScript returns empty arrays, use `browser_screenshot` to visually inspect the page and update selectors based on what you see.
- **Content search vs. job search**: This skill searches LinkedIn *posts/content* (where people announce hiring), not the LinkedIn Jobs board. This finds informal "we're hiring" posts that often have more context than formal job listings.
- **Alternative selectors to try if defaults fail**:
  - Posts container: `div[data-urn]`, `.occludable-update`
  - Post text: `.break-words span[dir="ltr"]`, `span.break-words`
  - Author: `.update-components-actor__title span[aria-hidden="true"]`
