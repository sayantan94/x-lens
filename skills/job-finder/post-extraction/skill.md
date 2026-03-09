---
name: post-extraction
description: Extract structured data from LinkedIn post DOM elements with fallback patterns
triggers: [extract posts, parse linkedin, post data, dom extraction]
---

## Instructions

This skill extracts structured post data from LinkedIn pages that have already been loaded in the browser. It handles LinkedIn's frequently-changing DOM by trying multiple selector strategies and includes deduplication and error recovery.

### Step 1: Extract Posts Using Cascading Selector Strategies

LinkedIn changes its DOM structure frequently. Try the following selector strategies in order using `browser_evaluate`. Use the first strategy that returns results.

#### Strategy 1: Activity URN selectors

```javascript
(() => {
  const posts = document.querySelectorAll('[data-urn*="urn:li:activity"]');
  const results = [];
  posts.forEach(post => {
    try {
      const authorEl = post.querySelector('.update-components-actor__name span[aria-hidden="true"]')
        || post.querySelector('.update-components-actor__title span[aria-hidden="true"]');
      const author = authorEl ? authorEl.innerText.trim() : 'Unknown';

      const titleEl = post.querySelector('.update-components-actor__description span[aria-hidden="true"]')
        || post.querySelector('.update-components-actor__subtitle span[aria-hidden="true"]');
      const authorTitle = titleEl ? titleEl.innerText.trim() : '';

      const textEl = post.querySelector('.feed-shared-update-v2__description')
        || post.querySelector('.update-components-text')
        || post.querySelector('.break-words span[dir="ltr"]');
      const text = textEl ? textEl.innerText.trim().substring(0, 1000) : '';

      const timeEl = post.querySelector('.update-components-actor__sub-description span[aria-hidden="true"]');
      const postedAt = timeEl ? timeEl.innerText.trim() : '';

      const linkEl = post.querySelector('a[href*="/feed/update/"]')
        || post.querySelector('a[href*="urn:li:activity"]');
      const url = linkEl ? linkEl.href.split('?')[0] : '';

      if (text.length > 10 || author !== 'Unknown') {
        results.push({ author, authorTitle, text, url, postedAt });
      }
    } catch (e) {}
  });
  return JSON.stringify(results);
})()
```

#### Strategy 2: Feed shared update selectors

If Strategy 1 returns 0 results, try:

```javascript
(() => {
  const posts = document.querySelectorAll('.feed-shared-update-v2');
  const results = [];
  posts.forEach(post => {
    try {
      const authorEl = post.querySelector('.update-components-actor__name span[aria-hidden="true"]')
        || post.querySelector('[class*="actor"] span[aria-hidden="true"]');
      const author = authorEl ? authorEl.innerText.trim() : 'Unknown';

      const titleEl = post.querySelector('.update-components-actor__description span[aria-hidden="true"]');
      const authorTitle = titleEl ? titleEl.innerText.trim() : '';

      const textEl = post.querySelector('.feed-shared-update-v2__description')
        || post.querySelector('.update-components-text')
        || post.querySelector('span.break-words');
      const text = textEl ? textEl.innerText.trim().substring(0, 1000) : '';

      const timeEl = post.querySelector('.update-components-actor__sub-description span[aria-hidden="true"]');
      const postedAt = timeEl ? timeEl.innerText.trim() : '';

      const linkEl = post.querySelector('a[href*="/feed/update/"]');
      const url = linkEl ? linkEl.href.split('?')[0] : '';

      if (text.length > 10 || author !== 'Unknown') {
        results.push({ author, authorTitle, text, url, postedAt });
      }
    } catch (e) {}
  });
  return JSON.stringify(results);
})()
```

#### Strategy 3: Search result container selectors

If Strategies 1 and 2 both return 0 results (common on search result pages), try:

```javascript
(() => {
  const posts = document.querySelectorAll('.reusable-search__result-container');
  const results = [];
  posts.forEach(post => {
    try {
      const authorEl = post.querySelector('.entity-result__title-text a span[aria-hidden="true"]')
        || post.querySelector('[class*="title"] span[aria-hidden="true"]');
      const author = authorEl ? authorEl.innerText.trim() : 'Unknown';

      const titleEl = post.querySelector('.entity-result__primary-subtitle')
        || post.querySelector('[class*="subtitle"]');
      const authorTitle = titleEl ? titleEl.innerText.trim() : '';

      const textEl = post.querySelector('.entity-result__summary')
        || post.querySelector('[class*="snippet"]');
      const text = textEl ? textEl.innerText.trim().substring(0, 1000) : '';

      const timeEl = post.querySelector('.entity-result__secondary-subtitle')
        || post.querySelector('time');
      const postedAt = timeEl ? timeEl.innerText.trim() : '';

      const linkEl = post.querySelector('a[href*="linkedin.com"]');
      const url = linkEl ? linkEl.href.split('?')[0] : '';

      if (text.length > 10 || author !== 'Unknown') {
        results.push({ author, authorTitle, text, url, postedAt });
      }
    } catch (e) {}
  });
  return JSON.stringify(results);
})()
```

### Step 2: Parse Company from authorTitle

After extracting raw posts, parse the `company` field from `authorTitle` using these separator patterns. Apply them in order and use the first match:

1. **"at" separator**: `"Senior Engineer at Acme Corp"` -> company is `"Acme Corp"`
   - Pattern: split on ` at ` (with spaces), take everything after the last occurrence
2. **Pipe separator**: `"Acme Corp | Senior Engineer"` -> company is `"Acme Corp"`
   - Pattern: split on ` | `, take the side that does NOT look like a job title (does not contain words like "Engineer", "Manager", "Director", "Lead", "Developer", "Designer", "Analyst", "VP", "Head of", "Founder", "CEO", "CTO")
3. **Dash separator**: `"Acme Corp - Senior Engineer"` -> company is `"Acme Corp"`
   - Pattern: split on ` - `, apply the same heuristic as pipe separator
4. **Comma separator**: `"Senior Engineer, Acme Corp"` -> company is `"Acme Corp"`
   - Pattern: split on `, `, take the side that does NOT look like a job title

If none of these patterns match, set `company` to an empty string.

Add the parsed `company` field to each post object using `browser_evaluate` or by processing the extracted JSON in your reasoning.

### Step 3: Deduplicate Posts

Before returning results, remove duplicate posts using this logic:

1. **Primary dedup (by URL)**: If two posts share the same non-empty `url`, keep only the first occurrence.
2. **Secondary dedup (by content)**: If a post has no `url` (empty string), deduplicate by matching `author` + first 100 characters of `text`. If both match another post, discard the duplicate.

### Step 4: Error Recovery

If **all three selector strategies return 0 posts**, follow this recovery sequence:

1. Use `browser_screenshot` to capture the current page state for diagnosis.
2. Try a fallback selector using `article` elements:
   ```javascript
   (() => {
     const posts = document.querySelectorAll('article');
     const results = [];
     posts.forEach(post => {
       try {
         const text = post.innerText.trim().substring(0, 1000);
         if (text.length > 20) {
           results.push({
             author: 'Unknown',
             authorTitle: '',
             company: '',
             text: text,
             url: '',
             postedAt: ''
           });
         }
       } catch (e) {}
     });
     return JSON.stringify(results);
   })()
   ```
3. If the `article` fallback also returns 0 results, wait 2 seconds using `browser_evaluate` with `await new Promise(r => setTimeout(r, 2000))`, then retry Strategy 1.
4. If still 0 results after retry, take another `browser_screenshot` and report the issue to the user. The page may require login, may have loaded incorrectly, or LinkedIn may have changed its DOM structure. Suggest the user inspect the screenshot and provide updated selectors.

### Step 5: Return Output

Return the final deduplicated posts as a JSON array. Each post object must have these fields:

```json
[
  {
    "author": "Jane Smith",
    "authorTitle": "Engineering Manager at Acme Corp",
    "company": "Acme Corp",
    "text": "We're hiring senior backend engineers...",
    "url": "https://www.linkedin.com/feed/update/urn:li:activity:1234567890",
    "postedAt": "2d"
  }
]
```

Store the extracted posts in memory using `memory_write` with key `extracted_posts` so other skills can reference the data.

### Important Notes

- **Always try all three strategies** before triggering error recovery. LinkedIn uses different DOM structures on feed pages vs. search result pages.
- **Selector fragility**: If selectors stop working, use `browser_screenshot` to visually inspect the page and identify the current class names. Update the selectors in your extraction JavaScript accordingly.
- **Text truncation**: Limit extracted `text` to 1000 characters to avoid oversized payloads. The full post can be viewed via the `url`.
- **Rate limiting**: If extracting from multiple pages in sequence, add short pauses between navigations to avoid triggering LinkedIn's rate limiting.
