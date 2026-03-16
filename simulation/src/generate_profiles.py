#!/usr/bin/env python3
"""Generate simulated market participant profiles from a scenario description."""

import argparse
import json
import os
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
- Mix of archetypes: retail_trader, institutional_pm, sell_side_analyst, financial_journalist, reddit_degen, fintwit_influencer, quant_trader, options_dealer, value_investor, momentum_trader, macro_strategist, contrarian
- Each persona should have a unique personality, backstory, and reason for their stance
- Sentiment bias should reflect their natural reaction to this specific scenario

Output JSON with this exact structure:
{{
  "agents": [
    {{
      "user_id": 0,
      "username": "lowercase_handle",
      "name": "Full Name",
      "bio": "200 char social media bio",
      "persona": "2000 char detailed backstory: trading style, experience, why they hold their current view on this scenario, what would change their mind, how they behave on social media, their posting style and language",
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
- persona: MUST be detailed (1500-2000 chars). Include their history, what positions they hold, why, and how they'd react to this scenario playing out"""


def parse_profiles(raw_response: str) -> list[AgentProfile]:
    """Parse LLM response into AgentProfile objects."""
    data = json.loads(raw_response)
    agents_data = data.get("agents", data if isinstance(data, list) else [])
    return [AgentProfile(**agent) for agent in agents_data]


def generate(scenario: str, count: int = 15) -> list[AgentProfile]:
    """Generate profiles by calling the LLM."""
    raw = completion(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_prompt(scenario, count)},
        ],
        response_format={"type": "json_object"},
        temperature=0.7,
    )
    return parse_profiles(raw)


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
