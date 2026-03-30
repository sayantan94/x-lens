"""Automatic fact-check layer for simulation agent posts.

Decision tree (checked by caller in run_simulation.py):
  1. Is it create_post or quote_post? No → skip
  2. Did agent search this round?     Yes → skip (trusted)
  3. Does post match FACT_SIGNALS?    No → skip (opinion)
  4. → Run fact-check pipeline: extract claims → Nova search → LLM verdict

Claim results are cached per session to avoid re-checking identical claims.
"""

import json
import logging
import re
from datetime import datetime

log = logging.getLogger("sim.fact_check")

# --- Cheap pre-filter: does the post contain anything verifiable? ---

FACT_SIGNALS = re.compile(
    r'\$\d'                                # dollar amounts: $195, $950
    r'|\d+%'                               # percentages: 5%, -12%
    r'|\d+\.\d{2}'                         # decimals with 2+ places: 195.32
    r'|earnings|revenue|EPS'               # financial metrics
    r'|upgraded|downgraded|price target'   # analyst actions
    r'|FDA|FOMC|CPI|Fed\b'                 # catalysts
    r'|broke.+(?:support|resistance)'      # technical claims
    r'|all.time.high|ATH|52.week'          # milestone claims
    r'|max pain|call wall|put wall',       # options structure claims
    re.IGNORECASE
)

# --- Prompts ---

ANALYST_PROMPT = (
    "You are a professional equity research analyst. Provide factual, data-driven answers "
    "with specific numbers, dates, and source attribution. Focus on actionable information for "
    "options trading decisions. Always mention price levels, dates, and analyst names when available."
)

EXTRACT_PROMPT = """Extract verifiable factual claims from this social media post about the stock market.
Only extract claims that can be checked against real data — prices, percentages, earnings dates,
analyst ratings, events, volume figures, etc. Ignore opinions, speculation clearly labeled as hypothetical,
and vague statements.

Post: {post_text}

Return a JSON array. If no verifiable claims, return [].
Example: [{{"claim": "AAPL is trading at $220", "type": "price"}}, {{"claim": "Morgan Stanley upgraded to Buy", "type": "analyst"}}]

JSON:"""

VERDICT_PROMPT = """Compare this claim against the search results and determine if it's accurate.

Claim: {claim}
Search results: {search_result}

Return JSON with exactly these fields:
{{"verdict": "verified" or "mismatch" or "unverifiable", "reality": "brief factual statement from search results", "explanation": "one sentence"}}

If the search results don't contain enough info to verify, use "unverifiable".

JSON:"""


# --- Session claim cache ---

_claim_cache: dict[str, dict] = {}


def reset_cache():
    """Reset claim cache between simulation runs."""
    _claim_cache.clear()


def has_verifiable_content(post_text: str) -> bool:
    """Cheap regex pre-filter: does the post contain anything that looks like a fact?"""
    return bool(FACT_SIGNALS.search(post_text))


def _parse_json_response(raw: str):
    """Parse LLM response, stripping markdown fences if present."""
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        text = text.rsplit("```", 1)[0]
    return json.loads(text)


def extract_claims(post_text: str) -> list[dict]:
    """Use LLM to extract verifiable claims from post text."""
    from ..llm import completion
    try:
        raw = completion(
            messages=[{"role": "user", "content": EXTRACT_PROMPT.format(post_text=post_text)}],
            temperature=0.0,
        )
        claims = _parse_json_response(raw)
        return claims if isinstance(claims, list) else []
    except Exception as e:
        log.warning(f"Claim extraction failed: {e}")
        return []


def verify_claim(claim_text: str) -> dict:
    """Search web for a claim via Nova and return the result."""
    import sys
    import os
    NOVA_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "..", "tools")
    if NOVA_PATH not in sys.path:
        sys.path.insert(0, NOVA_PATH)
    from nova_web_search import nova_web_search

    try:
        result = nova_web_search(claim_text, system_prompt=ANALYST_PROMPT)
        return result
    except Exception as e:
        log.warning(f"Nova search failed for claim {claim_text!r}: {e}")
        return {"text": "", "citations": []}


def judge_verdict(claim_text: str, search_result: dict) -> dict:
    """Use LLM to compare claim against search results and produce verdict."""
    from ..llm import completion
    try:
        raw = completion(
            messages=[{"role": "user", "content": VERDICT_PROMPT.format(
                claim=claim_text,
                search_result=search_result.get("text", "No results found.")
            )}],
            temperature=0.0,
        )
        verdict = _parse_json_response(raw)
        verdict["sources"] = [
            c.get("url") or c.get("domain", "")
            for c in search_result.get("citations", [])
        ]
        return verdict
    except Exception as e:
        log.warning(f"Verdict failed for {claim_text!r}: {e}")
        return {"verdict": "unverifiable", "reality": "", "explanation": str(e), "sources": []}


def fact_check_post(post_text: str) -> dict | None:
    """Run full fact-check pipeline on a post.

    Caller is responsible for the decision tree (agent searched? has facts?).
    This function handles: extract claims → search each → verdict → aggregate.

    Returns dict with claims/overall_verdict, or None if no extractable claims.
    Uses session cache to avoid re-checking identical claims.
    """
    claims = extract_claims(post_text)
    if not claims:
        return None

    checked_claims = []
    for c in claims:
        claim_text = c.get("claim", "")
        if not claim_text:
            continue

        # Check session cache
        cache_key = claim_text.lower().strip()
        if cache_key in _claim_cache:
            log.info(f"Cache hit for claim: {claim_text!r}")
            checked_claims.append(_claim_cache[cache_key])
            continue

        # Full pipeline: search → verdict
        search_result = verify_claim(claim_text)
        verdict = judge_verdict(claim_text, search_result)
        checked = {
            "claim": claim_text,
            "type": c.get("type", "unknown"),
            **verdict,
        }
        _claim_cache[cache_key] = checked
        checked_claims.append(checked)

        log.info(f"Fact-checked: {claim_text!r} → {verdict.get('verdict', '?')}")

    if not checked_claims:
        return None

    # Overall verdict
    verdicts = [c["verdict"] for c in checked_claims]
    if "mismatch" in verdicts:
        overall = "mismatch"
    elif all(v == "verified" for v in verdicts):
        overall = "verified"
    else:
        overall = "partial"

    return {
        "claims": checked_claims,
        "overall_verdict": overall,
        "checked_at": datetime.now().isoformat(),
    }
