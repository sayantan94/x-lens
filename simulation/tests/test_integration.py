# simulation/tests/test_integration.py
"""Integration test — requires a running LLM. Run manually with:
   LLM_API_KEY=... python -m pytest tests/test_integration.py -v -s
"""
import json
import os
import pytest
from pathlib import Path

pytestmark = pytest.mark.skipif(
    not os.getenv("LLM_API_KEY"),
    reason="LLM_API_KEY not set — skipping integration test"
)


def test_generate_profiles_e2e(tmp_path):
    from src.generate_profiles import generate
    profiles = generate("NVDA beats earnings by 20%, guides up for next quarter", count=5)
    assert len(profiles) == 5
    assert all(p.username for p in profiles)
    assert all(p.persona for p in profiles)
    # Should have mix of sentiments
    biases = [p.sentiment_bias for p in profiles]
    assert any(b > 0 for b in biases), "Should have at least one bull"


def test_generate_config_e2e(tmp_path):
    from src.generate_profiles import generate as gen_profiles
    from src.generate_config import generate as gen_config
    profiles = gen_profiles("Fed cuts rates by 50bp surprise", count=5)
    config = gen_config("sim_test", "Fed cuts rates by 50bp surprise", profiles)
    assert config.time_config.total_rounds > 0
    assert len(config.event_config.initial_posts) > 0


def test_report_generation_e2e(tmp_path):
    from src.generate_report import aggregate_actions, generate_report
    # Create fake actions
    actions = [
        {"round": 1, "platform": "twitter", "agent_id": 0, "agent_name": "Bull Mike",
         "action_type": "CREATE_POST", "action_args": {"content": "NVDA crushed earnings! Loading up."}},
        {"round": 2, "platform": "twitter", "agent_id": 1, "agent_name": "Bear Sarah",
         "action_type": "CREATE_POST", "action_args": {"content": "NVDA priced in. Selling the news."}},
        {"round": 3, "platform": "reddit", "agent_id": 2, "agent_name": "WSB Degen",
         "action_type": "CREATE_POST", "action_args": {"content": "YOLO NVDA 200c lets gooo"}},
        {"event": "simulation_complete"},
    ]
    agg = aggregate_actions(actions)
    report = generate_report("NVDA beats earnings by 20%", agg)
    assert "Simulation Signal" in report or "Signal" in report
    assert len(report) > 200
