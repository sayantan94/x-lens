#!/usr/bin/env python3
"""Generate simulated market participant profiles from a scenario description.

Fixed bugs:
- BUG#5: Added anti-hallucination constraints to agent personas
- Agents are now explicitly told NOT to fabricate prices, news, or events
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

from .models import AgentProfile
from .llm import completion


SYSTEM_PROMPT = """You are an expert at creating realistic social media personas for financial market simulations.

You generate diverse casts of market participants — each with distinct trading styles, biases, experience levels, and social media behaviors. Your personas must feel like real people, not caricatures.

You MUST output valid JSON with an "agents" array. No other text."""


def build_prompt(scenario: str, count: int = 15) -> str:
    """Build the user prompt for profile generation."""
    return f"""Create {count} simulated market participants for this scenario:

**Scenario:** {scenario}

Generate a diverse cast ensuring:
- Mix of bulls, bears, and neutrals (not evenly split — let the scenario bias it naturally)
- Mix of influence levels (a few high-influence voices, many regular participants)
- Mix of archetypes: retail_trader, institutional_pm, sell_side_analyst, financial_journalist, reddit_degen, fintwit_influencer, quant_trader, options_dealer, value_investor, momentum_trader, macro_strategist, contrarian, bull_lead_analyst, bear_lead_analyst
- You MUST include exactly ONE agent with archetype "bull_lead_analyst" and ONE with archetype "bear_lead_analyst". These are senior research analysts who ALWAYS use search_web to find real data before posting. They build fact-based thesis cases.
- The bull_lead_analyst must have sentiment_bias >= 0.5, influence_weight >= 3.0, activity_level >= 0.8
- The bear_lead_analyst must have sentiment_bias <= -0.5, influence_weight >= 3.0, activity_level >= 0.8
- Each persona should have a unique personality, backstory, and reason for their stance
- Sentiment bias should reflect their natural reaction to this specific scenario

CRITICAL — each persona MUST reference specific data from the scenario:
- Quote exact OI numbers, strike prices, P/C ratios, max pain levels, call/put walls
- Reference specific price levels, support/resistance, % from ATH
- Mention specific market data (VIX, sector breadth, volume vs avg)
- Include their specific positions (e.g. "holding 50 NVDA $200 calls expiring Mar 21" or "short 500 shares at $195")
- Their arguments MUST cite the data — not just "I'm bullish" but "the $200 call wall at 240K OI is a gamma magnet"

ANTI-HALLUCINATION RULE — EVERY persona MUST include this constraint in their persona text:
"GROUND RULES: I ALWAYS use the search_web tool to verify prices, news, earnings dates, and analyst ratings before stating them as fact. I do NOT make up future prices, breaking news, or events that haven't happened. If I want to discuss what COULD happen, I clearly label it as a hypothetical scenario, not a fact. When I see another user make a factual claim, I search to verify it before agreeing or disagreeing."

Output JSON with this exact structure:
{{
  "agents": [
    {{
      "user_id": 0,
      "username": "lowercase_handle",
      "name": "Full Name",
      "bio": "200 char social media bio",
      "persona": "2000 char detailed backstory including: trading style, experience, SPECIFIC positions held, exact data points supporting their view, what price levels or data would change their mind, how they behave on social media, their posting style and language. MUST end with the GROUND RULES statement.",
      "age": 34,
      "gender": "male|female|other",
      "mbti": "ENTJ",
      "profession": "Day Trader",
      "interested_topics": ["semiconductors", "options", "momentum"],
      "sentiment_bias": 0.8,
      "influence_weight": 1.5,
      "activity_level": 0.7,
      "archetype": "retail_bull"
    }}
  ]
}}

Fields:
- sentiment_bias: -1.0 (extreme bear) to 1.0 (extreme bull) — their stance on THIS scenario
- influence_weight: 0.5 (nobody) to 5.0 (major influencer with huge following)
- activity_level: 0.1 (lurker, rarely posts) to 1.0 (power poster, always online)
- archetype: one of the archetypes listed above
- user_id: sequential starting from 0
- persona: MUST be detailed (1500-2000 chars). MUST include specific OI data, price levels, and market data from the scenario. Include their positions, why they hold them, and what data would flip their view. MUST end with the GROUND RULES anti-hallucination statement."""


def repair_truncated_json(text: str) -> str:
    """Attempt to repair JSON truncated by LLM max tokens."""
    # Try as-is first
    try:
        json.loads(text)
        return text
    except json.JSONDecodeError:
        pass

    # Strategy 1: Find last complete object in the agents array
    # Look for the last complete '},' or '}]' pattern
    last_complete = -1
    depth = 0
    in_string = False
    escape = False
    for i, ch in enumerate(text):
        if escape:
            escape = False
            continue
        if ch == '\\':
            escape = True
            continue
        if ch == '"' and not escape:
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 1:  # Just closed an agent object
                last_complete = i

    if last_complete > 0:
        # Truncate to last complete agent, close the array and outer object
        repaired = text[:last_complete + 1] + '\n  ]\n}'
        try:
            json.loads(repaired)
            return repaired
        except json.JSONDecodeError:
            pass

    # Strategy 2: Brute force — keep removing from end until valid
    for end in range(len(text) - 1, len(text) // 2, -1):
        chunk = text[:end]
        for suffix in [']\n}', '\n  ]\n}', '"\n    }\n  ]\n}', '\n}']:
            try:
                json.loads(chunk + suffix)
                return chunk + suffix
            except json.JSONDecodeError:
                continue

    raise json.JSONDecodeError("Cannot repair truncated JSON", text, 0)


def parse_profiles(raw_response: str) -> list[AgentProfile]:
    """Parse LLM response into AgentProfile objects, with truncation repair."""
    text = raw_response.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text)
    text = repair_truncated_json(text)
    data = json.loads(text)
    agents_data = data.get("agents", data if isinstance(data, list) else [])
    if not agents_data:
        print(f"WARNING: No agents found. Keys in response: {list(data.keys()) if isinstance(data, dict) else type(data).__name__}", file=sys.stderr)
        print(f"WARNING: Raw response (first 500 chars): {text[:500]}", file=sys.stderr)

    # Clamp fields to valid ranges (LLM sometimes generates out-of-bounds)
    for agent in agents_data:
        agent["influence_weight"] = max(0.5, min(5.0, agent.get("influence_weight", 1.0)))
        agent["activity_level"] = max(0.1, min(1.0, agent.get("activity_level", 0.5)))
        agent["sentiment_bias"] = max(-1.0, min(1.0, agent.get("sentiment_bias", 0.0)))
    profiles = [AgentProfile(**agent) for agent in agents_data]

    # FIX#5: Inject anti-hallucination constraint if missing from persona
    ground_rules = (
        " GROUND RULES: I ALWAYS use the search_web tool to verify prices, news, earnings "
        "dates, and analyst ratings before stating them as fact. When I search, I ask for "
        "TODAY's or the LATEST data — not generic queries. I do NOT make up future "
        "prices, breaking news, or events that haven't happened. If I discuss what COULD "
        "happen, I clearly label it as hypothetical, not fact. When I see another user make "
        "a factual claim, I search to verify it before agreeing or disagreeing."
    )
    lead_rules = (
        " LEAD ANALYST RULES: I am a lead analyst. On EVERY post I make, I MUST first call "
        "search_web to get TODAY's data — current price, latest analyst ratings, most recent news, "
        "today's macro indicators (VIX, yields, breadth). I never rely on stale data from my persona "
        "context alone — I verify everything is still current. My search queries always include "
        "'today', 'latest', 'current' or the actual date. "
        "I build my thesis from FACTS — specific numbers, prices, analyst targets, earnings data, "
        "and macro indicators with sources. "
        "I structure my posts as: THESIS → EVIDENCE (with data points and dates) → RISK (what would "
        "invalidate this). I cite my sources. I challenge the opposing thesis with counter-evidence. "
        "I also reference the OI data, positioning, and market context I was given — combining "
        "seeded context with fresh web data for the most complete picture."
    )
    for p in profiles:
        if "GROUND RULES" not in p.persona:
            p.persona = p.persona.rstrip() + ground_rules
        if p.archetype in ("bull_lead_analyst", "bear_lead_analyst") and "LEAD ANALYST" not in p.persona:
            p.persona = p.persona.rstrip() + lead_rules

    return profiles


def generate(scenario: str, count: int = 15) -> list[AgentProfile]:
    """Generate profiles by calling the LLM, with retry on truncation."""
    attempt_count = count
    for attempt in range(3):
        raw = completion(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": build_prompt(scenario, attempt_count)},
            ],
            temperature=0.7,
        )
        profiles = parse_profiles(raw)
        if len(profiles) >= min(count, 10):
            print(f"Generated {len(profiles)}/{count} profiles (attempt {attempt+1})", file=sys.stderr)
            return profiles
        # Got too few — the JSON was heavily truncated. Try fewer.
        attempt_count = max(10, attempt_count - 5)
        print(f"Only got {len(profiles)} profiles, retrying with {attempt_count}...", file=sys.stderr)
    return profiles


def main():
    parser = argparse.ArgumentParser(description="Generate simulation agent profiles")
    parser.add_argument("--scenario", required=True, help="Market scenario to simulate")
    parser.add_argument("--count", type=int, default=15, help="Number of agents (default: 15)")
    parser.add_argument("--output", required=True, help="Output file path for profiles.json")
    args = parser.parse_args()

    profiles = generate(args.scenario, args.count)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps([p.model_dump() for p in profiles], indent=2))

    print(f"Generated {len(profiles)} profiles → {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
