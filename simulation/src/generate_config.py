#!/usr/bin/env python3
"""Generate simulation configuration from profiles and scenario."""

import argparse
import json
import os
import sys
from pathlib import Path

from .models import AgentProfile, SimulationConfig, TimeConfig, EventConfig
from .llm import completion

SYSTEM_PROMPT = """You are a simulation configuration expert. Given a market scenario and agent profiles, generate optimal simulation parameters.

You MUST output valid JSON. No other text."""


def build_agent_configs(profiles: list[AgentProfile]) -> list[dict]:
    """Build per-agent activity configs from profiles."""
    configs = []
    for p in profiles:
        # High activity agents are active more hours
        if p.activity_level > 0.7:
            active_hours = list(range(7, 24))
        elif p.activity_level > 0.4:
            active_hours = list(range(9, 22))
        else:
            active_hours = list(range(10, 18))

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
- total_simulation_hours: shorter for fast-moving events (earnings=48h), longer for macro shifts (96h)"""


def parse_config(raw: str, sim_id: str, scenario: str, profiles: list[AgentProfile]) -> SimulationConfig:
    """Parse LLM response into SimulationConfig."""
    data = json.loads(raw)
    tc_data = data.get("time_config", {})
    ec_data = data.get("event_config", {})

    return SimulationConfig(
        simulation_id=sim_id,
        scenario=scenario,
        time_config=TimeConfig(**tc_data),
        event_config=EventConfig(**ec_data),
        agent_configs=build_agent_configs(profiles),
    )


def generate(sim_id: str, scenario: str, profiles: list[AgentProfile]) -> SimulationConfig:
    """Generate config by calling the LLM."""
    raw = completion(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_config_prompt(scenario, profiles)},
        ],
        response_format={"type": "json_object"},
        temperature=0.3,
    )
    return parse_config(raw, sim_id, scenario, profiles)


def main():
    parser = argparse.ArgumentParser(description="Generate simulation configuration")
    parser.add_argument("--profiles", required=True, help="Path to profiles.json")
    parser.add_argument("--scenario", required=True, help="Market scenario")
    parser.add_argument("--sim-id", required=True, help="Simulation ID")
    parser.add_argument("--output", required=True, help="Output path for simulation_config.json")
    args = parser.parse_args()

    profiles_data = json.loads(Path(args.profiles).read_text())
    profiles = [AgentProfile(**p) for p in profiles_data]

    config = generate(args.sim_id, args.scenario, profiles)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(config.model_dump_json(indent=2))

    print(f"Generated config ({config.time_config.total_rounds} rounds) → {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
