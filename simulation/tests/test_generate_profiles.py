# simulation/tests/test_generate_profiles.py
import json
import pytest
from unittest.mock import patch, MagicMock
from src.generate_profiles import build_prompt, parse_profiles


def test_build_prompt_contains_scenario():
    prompt = build_prompt("NVDA beats earnings by 20%", count=15)
    assert "NVDA" in prompt
    assert "15" in prompt
    assert "sentiment_bias" in prompt
    assert "archetype" in prompt


def test_build_prompt_requests_diversity():
    prompt = build_prompt("Fed cuts rates 50bp", count=20)
    assert "bull" in prompt.lower()
    assert "bear" in prompt.lower()
    assert "neutral" in prompt.lower()


def test_parse_profiles_valid_json():
    raw = json.dumps({"agents": [
        {
            "user_id": 0, "username": "bull1", "name": "Mike",
            "bio": "Bull trader", "persona": "Momentum trader who...",
            "age": 30, "gender": "male", "mbti": "ENTJ",
            "profession": "Day Trader", "interested_topics": ["tech"],
            "sentiment_bias": 0.8, "influence_weight": 1.5,
            "activity_level": 0.7, "archetype": "retail_bull"
        }
    ]})
    profiles = parse_profiles(raw)
    assert len(profiles) == 1
    assert profiles[0].archetype == "retail_bull"
    assert profiles[0].sentiment_bias == 0.8


def test_parse_profiles_handles_missing_optional_fields():
    raw = json.dumps({"agents": [
        {
            "user_id": 0, "username": "u1", "name": "A",
            "bio": "Bio", "persona": "Persona",
            "profession": "Trader", "archetype": "general"
        }
    ]})
    profiles = parse_profiles(raw)
    assert profiles[0].sentiment_bias == 0.0
    assert profiles[0].activity_level == 0.5
