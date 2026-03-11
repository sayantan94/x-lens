# DOM Selectors for LinkedIn Post Extraction

This file contains the JavaScript extraction strategies used by the post-extraction skill. Each strategy targets a different LinkedIn DOM structure. Run these via `browser_evaluate`, trying in order until one returns results.

## Strategy 1: Activity URN Selectors

Works on standard LinkedIn feed pages where posts have `data-urn` attributes.

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

      // Try <a> tag first, then construct from data-urn attribute
      const linkEl = post.querySelector('a[href*="/feed/update/"]')
        || post.querySelector('a[href*="urn:li:activity"]');
      let url = linkEl ? linkEl.href.split('?')[0] : '';
      if (!url) {
        const urn = post.getAttribute('data-urn');
        if (urn) url = 'https://www.linkedin.com/feed/update/' + urn;
      }

      if (text.length > 10 || author !== 'Unknown') {
        results.push({ author, authorTitle, text, url, postedAt });
      }
    } catch (e) {}
  });
  return JSON.stringify(results);
})()
```

## Strategy 2: Feed Shared Update Selectors

Alternative feed layout. Use when Strategy 1 returns 0 results.

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

      // Try <a> tag first, then construct from data-urn on self or parent
      const linkEl = post.querySelector('a[href*="/feed/update/"]');
      let url = linkEl ? linkEl.href.split('?')[0] : '';
      if (!url) {
        const urnEl = post.closest('[data-urn*="urn:li:activity"]') || post.querySelector('[data-urn*="urn:li:activity"]');
        const urn = urnEl ? urnEl.getAttribute('data-urn') : null;
        if (urn) url = 'https://www.linkedin.com/feed/update/' + urn;
      }

      if (text.length > 10 || author !== 'Unknown') {
        results.push({ author, authorTitle, text, url, postedAt });
      }
    } catch (e) {}
  });
  return JSON.stringify(results);
})()
```

## Strategy 3: Search Result Container Selectors

Used on LinkedIn search result pages. Try when Strategies 1 and 2 both return 0 results.

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

## Article Fallback

Last-resort fallback when all three strategies return 0 results. Extracts raw text from `<article>` elements.

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

## Alternative Selectors Reference

If the primary selectors break due to LinkedIn DOM changes, try these alternatives:

| Element | Alternative Selectors |
|---|---|
| Post container | `[data-urn*="urn:li:activity"]`, `.feed-shared-update-v2`, `.occludable-update`, `article` |
| Author name | `.update-components-actor__name span[aria-hidden="true"]`, `.update-components-actor__title span[aria-hidden="true"]`, `[class*="actor"] span[aria-hidden="true"]` |
| Author title | `.update-components-actor__description span[aria-hidden="true"]`, `.update-components-actor__subtitle span[aria-hidden="true"]`, `[class*="subtitle"]` |
| Post text | `.feed-shared-update-v2__description`, `.update-components-text`, `.break-words span[dir="ltr"]`, `span.break-words` |
| Timestamp | `.update-components-actor__sub-description span[aria-hidden="true"]`, `time` |
| Post URL | `a[href*="/feed/update/"]`, `a[href*="urn:li:activity"]`, `a[href*="linkedin.com"]` |
| Search result title | `.entity-result__title-text a span[aria-hidden="true"]`, `[class*="title"] span[aria-hidden="true"]` |
| Search result snippet | `.entity-result__summary`, `[class*="snippet"]` |
