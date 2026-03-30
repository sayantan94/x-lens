#!/usr/bin/env python3
"""Generate simulation configuration from profiles and scenario.

Fixed bugs:
- BUG#3: Default active_hours now start at 7 AM minimum (no midnight-only agents)
- BUG#3: Simulation hours scaled to match max_rounds so no wasted rounds
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

from .models import AgentProfile, SimulationConfig, TimeConfig, EventConfig
from .llm import completion

SYSTEM_PROMPT = """You are a simulation configuration expert. Given a market scenario and agent profiles, generate optimal simulation parameters.

You MUST output valid JSON. No other text."""


def build_agent_configs(profiles: list[AgentProfile]) -> list[dict]:
    """Build per-agent activity configs from profiles.

    FIX#3: Ensure all agents have some overlap with market hours (7-23).
    High activity agents get wider windows, low activity get narrower,
    but EVERYONE is active during at least some market hours.
    """
    configs = []
    for p in profiles:
        if p.activity_level > 0.7:
            # Power posters: 7 AM - 11 PM (full market day + after hours)
            active_hours = list(range(7, 24))
        elif p.activity_level > 0.4:
            # Regular participants: 8 AM - 9 PM (core + some evening)
            active_hours = list(range(8, 22))
        else:
            # Lurkers: 9 AM - 5 PM (market hours only)
            active_hours = list(range(9, 18))

        configs.append({
            "agent_id": p.user_id,
            "entity_name": p.name,
            "active_hours": active_hours,
            "activity_level": p.activity_level,
        })
    return configs


def build_config_prompt(scenario: str, profiles: list[AgentProfile]) -> str:
    """Build the prompt for config generation."""
    profile_summary = "\n".join(
        f"- Agent {p.user_id}: {p.name} ({p.archetype}, bias={p.sentiment_bias}, influence={p.influence_weight})"
        for p in profiles
    )
    return f"""Generate simulation config for this scenario:

**Scenario:** {scenario}

**Agents ({len(profiles)}):**
{profile_summary}

Output JSON:
{{
  "time_config": {{
    "total_simulation_hours": 48-96,
    "minutes_per_round": 30 or 60
  }},
  "event_config": {{
    "hot_topics": ["topic1", "topic2"],
    "narrative_direction": "one sentence on expected sentiment flow",
    "initial_posts": [
      {{"poster_agent_id": <agent_id of most relevant agent>, "content": "realistic first post about this event"}}
    ]
  }}
}}

Rules:
- initial_posts: 2-5 seed posts from different agents who would realistically post first
- poster_agent_id must match an agent's user_id from the list above
- Pick agents whose archetype makes them likely to post first (journalists, influencers, active traders)
- total_simulation_hours: shorter for fast-moving events (earnings=48h), longer for macro shifts (96h)
- minutes_per_round: use 30 for fast events, 60 for slow-burn narratives"""


def parse_config(raw: str, sim_id: str, scenario: str, profiles: list[AgentProfile]) -> SimulationConfig:
    """Parse LLM response into SimulationConfig."""
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text)
    data = json.loads(text)
    tc_data = data.get("time_config", {})
    ec_data = data.get("event_config", {})

    return SimulationConfig(
        simulation_id=sim_id,
        scenario=scenario,
        time_config=TimeConfig(**tc_data),
        event_config=EventConfig(**ec_data),
        agent_configs=build_agent_configs(profiles),
    )


def generate(sim_id: str, scenario: str, profiles: list[AgentProfile],
             seed_posts: list[dict] | None = None) -> SimulationConfig:
    """Generate config by calling the LLM. Uses provided seed_posts if given."""
    raw = completion(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_config_prompt(scenario, profiles)},
        ],
        temperature=0.3,
    )
    config = parse_config(raw, sim_id, scenario, profiles)

    # Override LLM-generated initial_posts with agent-provided seed posts
    if seed_posts:
        config.event_config.initial_posts = seed_posts

    return config


def main():
    parser = argparse.ArgumentParser(description="Generate simulation configuration")
    parser.add_argument("--profiles", required=True, help="Path to profiles.json")
    parser.add_argument("--scenario", required=True, help="Market scenario")
    parser.add_argument("--sim-id", required=True, help="Simulation ID")
    parser.add_argument("--output", required=True, help="Output path for simulation_config.json")
    parser.add_argument("--seed-posts", default=None, help="Path to seed_posts.json (overrides LLM-generated seeds)")
    args = parser.parse_args()

    profiles_data = json.loads(Path(args.profiles).read_text())
    profiles = [AgentProfile(**p) for p in profiles_data]

    seed_posts = None
    if args.seed_posts:
        seed_posts = json.loads(Path(args.seed_posts).read_text())

    config = generate(args.sim_id, args.scenario, profiles, seed_posts=seed_posts)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(config.model_dump_json(indent=2))

    print(f"Generated config ({config.time_config.total_rounds} rounds) → {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
