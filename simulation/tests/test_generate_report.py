# simulation/tests/test_generate_report.py
import json
import pytest
from src.generate_report import aggregate_actions, build_report_prompt


def test_aggregate_actions():
    actions = [
        {"round": 1, "platform": "twitter", "agent_id": 0, "agent_name": "Bull Mike",
         "action_type": "CREATE_POST", "action_args": {"content": "NVDA moon! 🚀"}},
        {"round": 1, "platform": "twitter", "agent_id": 1, "agent_name": "Bear Sarah",
         "action_type": "CREATE_POST", "action_args": {"content": "NVDA overvalued, selling."}},
        {"round": 2, "platform": "twitter", "agent_id": 2, "agent_name": "Neutral Pat",
         "action_type": "LIKE_POST", "action_args": {"post_id": 1}},
        {"round": 2, "platform": "reddit", "agent_id": 0, "agent_name": "Bull Mike",
         "action_type": "CREATE_POST", "action_args": {"content": "Loading up on NVDA calls"}},
        {"event": "simulation_complete"},
    ]
    agg = aggregate_actions(actions)
    assert agg["total_actions"] == 4
    assert agg["platform_counts"]["twitter"] == 3
    assert agg["platform_counts"]["reddit"] == 1
    assert agg["action_type_counts"]["CREATE_POST"] == 3
    assert agg["action_type_counts"]["LIKE_POST"] == 1
    assert len(agg["agent_activity"]) == 3
    assert agg["agent_activity"]["Bull Mike"] == 2
    assert len(agg["posts"]) == 3


def test_build_report_prompt():
    agg = {
        "total_actions": 10,
        "total_rounds": 5,
        "platform_counts": {"twitter": 7, "reddit": 3},
        "action_type_counts": {"CREATE_POST": 5, "LIKE_POST": 3, "REPOST": 2},
        "agent_activity": {"Mike": 4, "Sarah": 3, "Pat": 3},
        "posts": [{"agent": "Mike", "content": "NVDA 🚀", "round": 1, "platform": "twitter"}],
    }
    prompt = build_report_prompt("NVDA earnings beat", agg)
    assert "NVDA" in prompt
    assert "Sentiment Trajectory" in prompt
    assert "Trading Implication" in prompt
