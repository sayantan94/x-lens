# Scoring Rubric

Detailed signal tables for each of the five ranking criteria used by the post-ranking skill.

## Direct Hiring Post (weight: 0.30)

Determine whether the post is an actual hiring announcement or just tangentially related content.

| Signal | Score |
|--------|-------|
| Phrases like "we're hiring", "join my team", "open role", "looking for a", "come work with us" | 0.8 - 1.0 |
| Job description details (requirements, qualifications, how to apply) | 0.9 - 1.0 |
| Author is a recruiter or hiring manager (check headline) | 0.7 - 0.9 |
| Generic career advice, motivational content, or industry commentary | 0.1 - 0.3 |
| Reshare of someone else's post with no added hiring context | 0.0 - 0.2 |

## Seniority Match (weight: 0.25)

Compare the role level mentioned in the post against the user's target seniority.

| Match Quality | Score |
|---------------|-------|
| Exact match (e.g., user wants "senior", post says "senior") | 1.0 |
| Adjacent level (e.g., user wants "senior", post says "staff" or "mid-level") | 0.7 |
| Seniority not mentioned in the post | 0.5 |
| Wrong level entirely (e.g., user wants "senior", post says "intern" or "VP") | 0.2 |

## Location Match (weight: 0.20)

Compare the post's location information against the user's preferred location.

| Match Quality | Score |
|---------------|-------|
| Exact city match | 1.0 |
| Same state or metro area | 0.8 |
| Remote or hybrid mentioned | 0.7 |
| Country match only | 0.5 |
| No location mentioned | 0.3 |
| Explicitly a different city/country with no remote option | 0.1 |

## Company Match (weight: 0.15)

Check if the post's company aligns with the user's stated company preferences (specific companies, company types, industries, or size).

| Match Quality | Score |
|---------------|-------|
| Named company the user specifically requested | 1.0 |
| Company matches a stated category (e.g., "startup", "FAANG", "fintech") | 0.7 |
| Company identifiable but no match to user preferences | 0.4 |
| No company information available | 0.2 |

## Recency (weight: 0.10)

How recently the post was published.

| Recency | Score |
|---------|-------|
| Today | 1.0 |
| Yesterday | 0.8 |
| This week (2-7 days) | 0.6 |
| Last week (8-14 days) | 0.3 |
| Older than 2 weeks | 0.1 |
