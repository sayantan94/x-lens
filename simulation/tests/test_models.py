import json
import pytest
from src.models import AgentProfile, TimeConfig, EventConfig, SimulationConfig, InterviewRequest, InterviewResponse


def test_agent_profile_defaults():
    p = AgentProfile(
        user_id=0, username="bull_trader_42", name="Mike Chen",
        bio="Full-time day trader. NVDA bull.",
        persona="Mike is a 34-year-old momentum trader...",
        profession="Day Trader", archetype="retail_bull",
    )
    assert p.sentiment_bias == 0.0
    assert p.influence_weight == 1.0
    assert p.activity_level == 0.5
    assert p.gender == "male"
    assert p.interested_topics == []


def test_agent_profile_to_reddit_format():
    p = AgentProfile(
        user_id=0, username="bear_pm", name="Sarah Lee",
        bio="PM at a hedge fund", persona="...", profession="PM",
        archetype="institutional_short", sentiment_bias=-0.7,
    )
    reddit = p.to_reddit_format()
    assert reddit["user_id"] == 0
    assert reddit["username"] == "bear_pm"
    assert "karma" in reddit


def test_agent_profile_to_twitter_format():
    p = AgentProfile(
        user_id=1, username="fintwit_guru", name="Alex",
        bio="Options trader", persona="...", profession="Trader",
        archetype="fintwit_influencer",
    )
    twitter = p.to_twitter_format()
    assert "user_id" in twitter
    assert "user_char" in twitter
    assert "description" in twitter


def test_time_config_total_rounds():
    tc = TimeConfig(total_simulation_hours=72, minutes_per_round=60)
    assert tc.total_rounds == 72


def test_simulation_config_serialization():
    tc = TimeConfig(total_simulation_hours=24, minutes_per_round=30)
    ec = EventConfig(
        hot_topics=["NVDA earnings"],
        narrative_direction="bullish momentum",
        initial_posts=[{"poster_agent_id": 0, "content": "NVDA crushed it!"}],
    )
    sc = SimulationConfig(
        simulation_id="sim_test", scenario="NVDA beats earnings",
        time_config=tc, event_config=ec,
        agent_configs=[{"agent_id": 0, "active_hours": list(range(9, 23)), "activity_level": 0.6}],
    )
    data = json.loads(sc.model_dump_json())
    assert data["simulation_id"] == "sim_test"
    assert data["time_config"]["total_simulation_hours"] == 24


def test_interview_request():
    req = InterviewRequest(agent_id=5, prompt="Would you buy?")
    assert req.agent_id == 5


def test_interview_response():
    resp = InterviewResponse(agent_id=5, agent_name="Mike", archetype="retail_bull", response="Yes, buying more!")
    d = resp.model_dump()
    assert d["archetype"] == "retail_bull"
