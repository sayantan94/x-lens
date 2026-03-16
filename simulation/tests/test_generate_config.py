# simulation/tests/test_generate_config.py
import json
import pytest
from src.generate_config import build_config_prompt, parse_config, build_agent_configs
from src.models import AgentProfile, SimulationConfig


def test_build_config_prompt_contains_scenario():
    profiles = [
        AgentProfile(user_id=0, username="u0", name="A", bio="b", persona="p",
                     profession="Trader", archetype="retail_bull", activity_level=0.8),
    ]
    prompt = build_config_prompt("NVDA earnings beat", profiles)
    assert "NVDA" in prompt
    assert "retail_bull" in prompt


def test_build_agent_configs_from_profiles():
    profiles = [
        AgentProfile(user_id=0, username="u0", name="Day Trader", bio="b", persona="p",
                     profession="Day Trader", archetype="retail_bull", activity_level=0.8),
        AgentProfile(user_id=1, username="u1", name="PM", bio="b", persona="p",
                     profession="PM", archetype="institutional_pm", activity_level=0.3),
    ]
    configs = build_agent_configs(profiles)
    assert len(configs) == 2
    assert configs[0]["agent_id"] == 0
    assert configs[0]["activity_level"] == 0.8
    assert "active_hours" in configs[0]


def test_parse_config_valid():
    raw = json.dumps({
        "time_config": {
            "total_simulation_hours": 48,
            "minutes_per_round": 60,
        },
        "event_config": {
            "hot_topics": ["NVDA", "earnings"],
            "narrative_direction": "bullish momentum after beat",
            "initial_posts": [
                {"poster_agent_id": 0, "content": "NVDA just crushed earnings!"}
            ]
        }
    })
    profiles = [
        AgentProfile(user_id=0, username="u0", name="A", bio="b", persona="p",
                     profession="Trader", archetype="retail_bull"),
    ]
    config = parse_config(raw, "sim_test", "NVDA earnings", profiles)
    assert isinstance(config, SimulationConfig)
    assert config.time_config.total_simulation_hours == 48
    assert len(config.event_config.initial_posts) == 1
