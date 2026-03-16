# simulation/tests/test_run_simulation.py
import json
import pytest
from src.run_simulation import (
    get_active_agents,
    get_time_multiplier,
    load_profiles_for_platform,
    log_action,
)
from src.models import TimeConfig


def test_get_time_multiplier_peak():
    tc = TimeConfig(peak_hours=[9, 10], off_peak_hours=[0, 1], peak_activity_multiplier=1.5, off_peak_activity_multiplier=0.3)
    assert get_time_multiplier(tc, 9) == 1.5
    assert get_time_multiplier(tc, 0) == 0.3
    assert get_time_multiplier(tc, 12) == 1.0  # normal hours


def test_get_active_agents():
    agent_configs = [
        {"agent_id": 0, "active_hours": [9, 10, 11], "activity_level": 1.0},
        {"agent_id": 1, "active_hours": [20, 21, 22], "activity_level": 1.0},
        {"agent_id": 2, "active_hours": [9, 10, 11], "activity_level": 0.0},
    ]
    # Hour 9: agent 0 is active (level 1.0), agent 1 is not (wrong hours), agent 2 has 0 activity
    active = get_active_agents(agent_configs, simulated_hour=9, multiplier=1.0)
    # Agent 0 should always be selected (activity_level=1.0), agent 2 never (0.0)
    assert 0 in active
    assert 1 not in active


def test_log_action(tmp_path):
    log_path = tmp_path / "actions.jsonl"
    log_action(str(log_path), round_num=1, platform="twitter", agent_id=0,
               agent_name="Mike", action_type="CREATE_POST",
               action_args={"content": "NVDA to the moon!"})

    lines = log_path.read_text().strip().split("\n")
    assert len(lines) == 1
    entry = json.loads(lines[0])
    assert entry["round"] == 1
    assert entry["action_type"] == "CREATE_POST"
