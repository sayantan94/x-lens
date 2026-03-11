# Job Finder Posts UI Design

## Problem
The job-finder persona saves LinkedIn hiring posts to `~/.x-lens/linkedin-posts.jsonl`, but there's no way to browse or read them. Users need a UI to scan collected posts, sort by relevance or date, and click through to LinkedIn.

## Decision
Add a `/jobs` page to the existing status server (`status-server.ts`). Same pattern as the existing dashboard — self-contained HTML/CSS/JS embedded in a TypeScript string, dark theme, no new dependencies.

## Architecture

### Routes
- `GET /jobs` — serves the HTML page
- `GET /api/jobs` — reads `~/.x-lens/linkedin-posts.jsonl`, parses each line, returns JSON array

### UI Layout
Table view with columns: Score, Author, Company, Location, Seniority, Posted, Text snippet.

Controls bar at top:
- Text search input (filters across all fields client-side)
- Sort toggle: by score (default) or by date
- Post count indicator

Row click expands inline to show full post text + "View on LinkedIn" link.

### Data Flow
1. Page loads, fetches `/api/jobs`
2. Server reads JSONL file, parses valid lines, returns JSON array
3. Client renders table sorted by score descending
4. Search and sort are client-side only

### Error States
- File missing or empty: "No posts collected yet. Run a LinkedIn search first."
- Malformed JSONL lines: skip silently, render valid entries

### Styling
- Dark theme matching existing dashboard (same CSS custom properties)
- Amber accent colors consistent with status page
- Score displayed as colored badge (green > 0.7, amber 0.5-0.7, gray < 0.5)

## Alternatives Considered
1. **Static HTML generator** — CLI command generates standalone HTML file. Rejected: stale data, different pattern.
2. **Separate server** — Own port/process. Rejected: unnecessary complexity.
