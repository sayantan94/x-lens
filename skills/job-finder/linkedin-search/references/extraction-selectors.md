# LinkedIn Post Extraction Selectors

LinkedIn DOM selectors change frequently. If the primary selectors return empty results, try the alternatives listed below, or take a `browser_screenshot` to inspect current class names and adjust.

## Primary Extraction Script

Run this via `browser_evaluate` after scrolling:

```javascript
(() => {
  const posts = document.querySelectorAll('.feed-shared-update-v2');
  const results = [];
  posts.forEach(post => {
    try {
      // Author name
      const authorEl = post.querySelector('.update-components-actor__name span[aria-hidden="true"]');
      const author = authorEl ? authorEl.innerText.trim() : 'Unknown';

      // Author headline / subtitle
      const headlineEl = post.querySelector('.update-components-actor__description span[aria-hidden="true"]');
      const headline = headlineEl ? headlineEl.innerText.trim() : '';

      // Post text content (first 500 chars)
      const textEl = post.querySelector('.feed-shared-update-v2__description, .update-components-text');
      const text = textEl ? textEl.innerText.trim().substring(0, 500) : '';

      // Timestamp
      const timeEl = post.querySelector('.update-components-actor__sub-description span[aria-hidden="true"]');
      const time = timeEl ? timeEl.innerText.trim() : '';

      // Post permalink
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

## Alternative Selectors

Use these if primary selectors return empty arrays:

| Element | Primary Selector | Alternative Selectors |
|---|---|---|
| Posts container | `.feed-shared-update-v2` | `div[data-urn]`, `.occludable-update` |
| Post text | `.feed-shared-update-v2__description`, `.update-components-text` | `.break-words span[dir="ltr"]`, `span.break-words` |
| Author name | `.update-components-actor__name span[aria-hidden="true"]` | `.update-components-actor__title span[aria-hidden="true"]` |
| Author headline | `.update-components-actor__description span[aria-hidden="true"]` | `.update-components-actor__subtitle span[aria-hidden="true"]` |
| Timestamp | `.update-components-actor__sub-description span[aria-hidden="true"]` | `time`, `.update-components-actor__sub-description` |
| Post link | `a.app-aware-link[href*="/feed/update/"]` | `a[href*="activity"]`, `.feed-shared-update-v2 a[href*="/feed/"]` |

## Selector Debugging Steps

1. Run `document.querySelectorAll('.feed-shared-update-v2').length` to check if the primary posts container exists
2. If it returns `0`, try each alternative container selector
3. Once you find a working container, inspect one element's inner HTML to identify current child selectors
4. Update the extraction script with the working selectors before running the full extraction
