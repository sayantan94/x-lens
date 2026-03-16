# Social Sentiment Simulation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Python-based social simulation package to x-lens that lets the trader persona simulate how market narratives propagate through Twitter/Reddit crowds, interview simulated agents, and extract trading signals.

**Architecture:** Python subprocess package at `simulation/` using OASIS framework (`camel-oasis`). The trader persona orchestrates via `shell` tool calls. No Flask, no Neo4j, no knowledge graph. LLM-generated agent profiles from scenario prompts.

**Tech Stack:** Python 3.11+, camel-oasis 0.2.5, camel-ai 0.2.78, openai SDK, pydantic, python-dotenv

---

### Task 1: Python Package Scaffold

**Files:**
- Create: `simulation/pyproject.toml`
- Create: `simulation/src/__init__.py`
- Create: `simulation/.env.example`
- Create: `simulation/.gitignore`

**Step 1: Create pyproject.toml**

```toml
[build-system]
requires = ["setuptools>=68.0"]
build-backend = "setuptools.backends._legacy:_Backend"

[project]
name = "x-lens-simulation"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "camel-oasis==0.2.5",
    "camel-ai==0.2.78",
    "openai>=1.0.0",
    "pydantic>=2.0.0",
    "python-dotenv>=1.0.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0.0", "pytest-asyncio>=0.24.0"]
```

**Step 2: Create .env.example**

```env
# LLM Configuration (OpenAI-compatible)
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL_NAME=gpt-4o-mini
```

**Step 3: Create .gitignore**

```
__pycache__/
*.pyc
.venv/
*.egg-info/
dist/
.env
```

**Step 4: Create src/__init__.py**

```python
"""x-lens social simulation package."""
```

**Step 5: Set up virtual environment and install**

Run: `cd simulation && python3 -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]"`
Expected: Install completes, camel-oasis available

**Step 6: Commit**

```bash
git add simulation/pyproject.toml simulation/src/__init__.py simulation/.env.example simulation/.gitignore
git commit -m "feat(simulation): scaffold Python package with OASIS deps"
```

---

### Task 2: Pydantic Models

**Files:**
- Create: `simulation/src/models.py`
- Create: `simulation/tests/test_models.py`

**Step 1: Write the test**

```python
# simulation/tests/test_models.py
import json
import pytest
from src.models import AgentProfile, TimeConfig, EventConfig, SimulationConfig, InterviewRequest, InterviewResponse


def test_agent_profile_defaults():
    p = AgentProfile(
        user_id=0,
        username="bull_trader_42",
        name="Mike Chen",
        bio="Full-time day trader. NVDA bull.",
        persona="Mike is a 34-year-old momentum trader...",
        profession="Day Trader",
        archetype="retail_bull",
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
        simulation_id="sim_test",
        scenario="NVDA beats earnings",
        time_config=tc,
        event_config=ec,
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
```

**Step 2: Run test to verify it fails**

Run: `cd simulation && source .venv/bin/activate && python -m pytest tests/test_models.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.models'`

**Step 3: Write models.py**

```python
# simulation/src/models.py
"""Pydantic models for simulation data structures."""

from typing import Optional
from pydantic import BaseModel, Field


class AgentProfile(BaseModel):
    """A simulated market participant."""
    user_id: int
    username: str
    name: str
    bio: str = Field(max_length=500)
    persona: str = Field(max_length=5000)
    age: int = 30
    gender: str = "male"
    mbti: str = "INTJ"
    profession: str = "Trader"
    interested_topics: list[str] = Field(default_factory=list)
    sentiment_bias: float = Field(default=0.0, ge=-1.0, le=1.0)
    influence_weight: float = Field(default=1.0, ge=0.5, le=5.0)
    activity_level: float = Field(default=0.5, ge=0.1, le=1.0)
    archetype: str = "general"

    def to_reddit_format(self) -> dict:
        """Convert to OASIS Reddit JSON format."""
        return {
            "user_id": self.user_id,
            "username": self.username,
            "name": self.name,
            "bio": self.bio[:150],
            "persona": self.persona,
            "karma": int(self.influence_weight * 1000),
            "created_at": "2024-01-01",
            "age": self.age,
            "gender": self.gender,
            "mbti": self.mbti,
            "country": "US",
            "profession": self.profession,
            "interested_topics": self.interested_topics,
        }

    def to_twitter_format(self) -> dict:
        """Convert to OASIS Twitter CSV row format."""
        user_char = f"{self.bio} {self.persona}".replace("\n", " ").replace("\r", " ")
        return {
            "user_id": self.user_id,
            "name": self.name,
            "username": self.username,
            "user_char": user_char,
            "description": self.bio.replace("\n", " ")[:150],
        }


class TimeConfig(BaseModel):
    """Simulation timing parameters."""
    total_simulation_hours: int = 72
    minutes_per_round: int = 60
    agents_per_hour_min: int = 5
    agents_per_hour_max: int = 20
    peak_hours: list[int] = Field(default_factory=lambda: [9, 10, 11, 14, 15, 20, 21, 22])
    off_peak_hours: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4, 5])
    peak_activity_multiplier: float = 1.5
    off_peak_activity_multiplier: float = 0.3

    @property
    def total_rounds(self) -> int:
        return int(self.total_simulation_hours * 60 / self.minutes_per_round)


class EventConfig(BaseModel):
    """Initial simulation events."""
    hot_topics: list[str] = Field(default_factory=list)
    narrative_direction: str = ""
    initial_posts: list[dict] = Field(default_factory=list)


class SimulationConfig(BaseModel):
    """Complete simulation configuration."""
    simulation_id: str
    scenario: str
    time_config: TimeConfig
    event_config: EventConfig
    agent_configs: list[dict] = Field(default_factory=list)
    platform_config: dict = Field(default_factory=lambda: {
        "twitter": {"recency_weight": 0.4, "popularity_weight": 0.3, "relevance_weight": 0.3},
        "reddit": {"recency_weight": 0.3, "popularity_weight": 0.4, "relevance_weight": 0.3},
    })


class InterviewRequest(BaseModel):
    """Request to interview a simulated agent."""
    agent_id: int
    prompt: str
    platform: Optional[str] = None


class InterviewResponse(BaseModel):
    """Response from an interviewed agent."""
    agent_id: int
    agent_name: str
    archetype: str
    response: str
    platform: Optional[str] = None
```

**Step 4: Run test to verify it passes**

Run: `cd simulation && source .venv/bin/activate && python -m pytest tests/test_models.py -v`
Expected: All 7 tests PASS

**Step 5: Commit**

```bash
git add simulation/src/models.py simulation/tests/test_models.py
git commit -m "feat(simulation): add Pydantic models for profiles, config, interviews"
```

---

### Task 3: Profile Generation

**Files:**
- Create: `simulation/src/generate_profiles.py`
- Create: `simulation/tests/test_generate_profiles.py`

**Step 1: Write the test**

```python
# simulation/tests/test_generate_profiles.py
import json
import pytest
from unittest.mock import patch, MagicMock
from src.generate_profiles import build_prompt, parse_profiles, main as gen_main


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
```

**Step 2: Run test to verify it fails**

Run: `cd simulation && source .venv/bin/activate && python -m pytest tests/test_generate_profiles.py -v`
Expected: FAIL — `ModuleNotFoundError`

**Step 3: Write generate_profiles.py**

```python
#!/usr/bin/env python3
"""Generate simulated market participant profiles from a scenario description."""

import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

from .models import AgentProfile

# Load .env from simulation/ directory
load_dotenv(Path(__file__).parent.parent / ".env")


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
    client = OpenAI(
        api_key=os.getenv("LLM_API_KEY", os.getenv("OPENAI_API_KEY", "ollama")),
        base_url=os.getenv("LLM_BASE_URL", os.getenv("OPENAI_BASE_URL", "http://localhost:11434/v1")),
    )
    model = os.getenv("LLM_MODEL_NAME", os.getenv("OPENAI_MODEL", "gpt-4o-mini"))

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_prompt(scenario, count)},
        ],
        response_format={"type": "json_object"},
        temperature=0.7,
    )

    return parse_profiles(response.choices[0].message.content)


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
```

**Step 4: Run test to verify it passes**

Run: `cd simulation && source .venv/bin/activate && python -m pytest tests/test_generate_profiles.py -v`
Expected: All 4 tests PASS

**Step 5: Commit**

```bash
git add simulation/src/generate_profiles.py simulation/tests/test_generate_profiles.py
git commit -m "feat(simulation): add LLM-based profile generation from scenario"
```

---

### Task 4: Config Generation

**Files:**
- Create: `simulation/src/generate_config.py`
- Create: `simulation/tests/test_generate_config.py`

**Step 1: Write the test**

```python
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
```

**Step 2: Run test to verify it fails**

Run: `cd simulation && source .venv/bin/activate && python -m pytest tests/test_generate_config.py -v`
Expected: FAIL

**Step 3: Write generate_config.py**

```python
#!/usr/bin/env python3
"""Generate simulation configuration from profiles and scenario."""

import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

from .models import AgentProfile, SimulationConfig, TimeConfig, EventConfig

load_dotenv(Path(__file__).parent.parent / ".env")

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
    client = OpenAI(
        api_key=os.getenv("LLM_API_KEY", os.getenv("OPENAI_API_KEY", "ollama")),
        base_url=os.getenv("LLM_BASE_URL", os.getenv("OPENAI_BASE_URL", "http://localhost:11434/v1")),
    )
    model = os.getenv("LLM_MODEL_NAME", os.getenv("OPENAI_MODEL", "gpt-4o-mini"))

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_config_prompt(scenario, profiles)},
        ],
        response_format={"type": "json_object"},
        temperature=0.3,
    )

    return parse_config(response.choices[0].message.content, sim_id, scenario, profiles)


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
```

**Step 4: Run tests**

Run: `cd simulation && source .venv/bin/activate && python -m pytest tests/test_generate_config.py -v`
Expected: All 3 tests PASS

**Step 5: Commit**

```bash
git add simulation/src/generate_config.py simulation/tests/test_generate_config.py
git commit -m "feat(simulation): add config generation from profiles + scenario"
```

---

### Task 5: IPC Protocol

**Files:**
- Create: `simulation/src/ipc.py`
- Create: `simulation/tests/test_ipc.py`

**Step 1: Write the test**

```python
# simulation/tests/test_ipc.py
import json
import os
import tempfile
import time
import pytest
from pathlib import Path
from src.ipc import IPCServer, IPCClient, CommandType


def test_command_roundtrip():
    with tempfile.TemporaryDirectory() as tmpdir:
        server = IPCServer(tmpdir)
        client = IPCClient(tmpdir)

        # Client sends command
        cmd_id = client.send_command(
            CommandType.INTERVIEW,
            {"agent_id": 5, "prompt": "Would you buy?"}
        )
        assert cmd_id is not None

        # Server reads command
        cmd = server.poll_command()
        assert cmd is not None
        assert cmd["command_type"] == "interview"
        assert cmd["args"]["agent_id"] == 5

        # Server sends response
        server.send_response(cmd["command_id"], {
            "agent_id": 5, "agent_name": "Mike", "response": "Yes!"
        })

        # Client reads response
        resp = client.wait_response(cmd_id, timeout=5)
        assert resp is not None
        assert resp["agent_name"] == "Mike"


def test_poll_command_returns_none_when_empty():
    with tempfile.TemporaryDirectory() as tmpdir:
        server = IPCServer(tmpdir)
        assert server.poll_command() is None


def test_client_timeout():
    with tempfile.TemporaryDirectory() as tmpdir:
        client = IPCClient(tmpdir)
        cmd_id = client.send_command(CommandType.INTERVIEW, {"agent_id": 0, "prompt": "hi"})
        resp = client.wait_response(cmd_id, timeout=1)
        assert resp is None
```

**Step 2: Run test to verify it fails**

Run: `cd simulation && source .venv/bin/activate && python -m pytest tests/test_ipc.py -v`
Expected: FAIL

**Step 3: Write ipc.py**

```python
"""File-based IPC for communicating with running simulation processes.

Uses JSON files in a shared directory:
- ipc_commands/{command_id}.json  — client writes, server reads
- ipc_responses/{command_id}.json — server writes, client reads
"""

import json
import os
import time
from enum import Enum
from pathlib import Path
from uuid import uuid4


class CommandType(str, Enum):
    INTERVIEW = "interview"
    BATCH_INTERVIEW = "batch_interview"
    CLOSE_ENV = "close_env"


class IPCServer:
    """Server side — runs inside the simulation process."""

    def __init__(self, ipc_dir: str):
        self.commands_dir = Path(ipc_dir) / "ipc_commands"
        self.responses_dir = Path(ipc_dir) / "ipc_responses"
        self.commands_dir.mkdir(parents=True, exist_ok=True)
        self.responses_dir.mkdir(parents=True, exist_ok=True)

    def poll_command(self) -> dict | None:
        """Check for pending commands. Returns oldest unprocessed command or None."""
        cmd_files = sorted(self.commands_dir.glob("*.json"))
        if not cmd_files:
            return None

        cmd_path = cmd_files[0]
        try:
            cmd = json.loads(cmd_path.read_text())
            cmd_path.unlink()
            return cmd
        except (json.JSONDecodeError, FileNotFoundError):
            return None

    def send_response(self, command_id: str, result: dict):
        """Write response for a command."""
        resp_path = self.responses_dir / f"{command_id}.json"
        resp_path.write_text(json.dumps({
            "command_id": command_id,
            "result": result,
            "timestamp": time.time(),
        }))


class IPCClient:
    """Client side — used by interview.py to talk to running simulation."""

    def __init__(self, ipc_dir: str):
        self.commands_dir = Path(ipc_dir) / "ipc_commands"
        self.responses_dir = Path(ipc_dir) / "ipc_responses"
        self.commands_dir.mkdir(parents=True, exist_ok=True)
        self.responses_dir.mkdir(parents=True, exist_ok=True)

    def send_command(self, command_type: CommandType, args: dict) -> str:
        """Send a command to the simulation process. Returns command_id."""
        command_id = str(uuid4())
        cmd = {
            "command_id": command_id,
            "command_type": command_type.value,
            "args": args,
            "timestamp": time.time(),
        }
        cmd_path = self.commands_dir / f"{command_id}.json"
        cmd_path.write_text(json.dumps(cmd))
        return command_id

    def wait_response(self, command_id: str, timeout: float = 60) -> dict | None:
        """Wait for a response to a command. Returns result dict or None on timeout."""
        resp_path = self.responses_dir / f"{command_id}.json"
        deadline = time.time() + timeout

        while time.time() < deadline:
            if resp_path.exists():
                try:
                    data = json.loads(resp_path.read_text())
                    resp_path.unlink()
                    return data.get("result")
                except (json.JSONDecodeError, FileNotFoundError):
                    pass
            time.sleep(0.5)

        return None
```

**Step 4: Run tests**

Run: `cd simulation && source .venv/bin/activate && python -m pytest tests/test_ipc.py -v`
Expected: All 3 tests PASS

**Step 5: Commit**

```bash
git add simulation/src/ipc.py simulation/tests/test_ipc.py
git commit -m "feat(simulation): add file-based IPC protocol for interviews"
```

---

### Task 6: Simulation Runner

**Files:**
- Create: `simulation/src/run_simulation.py`
- Create: `simulation/tests/test_run_simulation.py`

**Step 1: Write the test** (unit tests for helpers, not the full OASIS integration)

```python
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
```

**Step 2: Run test to verify it fails**

Run: `cd simulation && source .venv/bin/activate && python -m pytest tests/test_run_simulation.py -v`
Expected: FAIL

**Step 3: Write run_simulation.py**

```python
#!/usr/bin/env python3
"""Run OASIS social simulation. Writes actions.jsonl and stays alive for IPC interviews."""

import argparse
import asyncio
import csv
import json
import os
import random
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

from .ipc import IPCServer, CommandType
from .models import AgentProfile, SimulationConfig, TimeConfig

load_dotenv(Path(__file__).parent.parent / ".env")


def get_time_multiplier(tc: TimeConfig, simulated_hour: int) -> float:
    """Get activity multiplier for the current simulated hour."""
    if simulated_hour in tc.peak_hours:
        return tc.peak_activity_multiplier
    elif simulated_hour in tc.off_peak_hours:
        return tc.off_peak_activity_multiplier
    return 1.0


def get_active_agents(agent_configs: list[dict], simulated_hour: int, multiplier: float) -> list[int]:
    """Select which agents are active this round."""
    active = []
    for ac in agent_configs:
        if simulated_hour not in ac.get("active_hours", range(24)):
            continue
        effective_level = ac.get("activity_level", 0.5) * multiplier
        if random.random() < effective_level:
            active.append(ac["agent_id"])
    return active


def log_action(log_path: str, round_num: int, platform: str, agent_id: int,
               agent_name: str, action_type: str, action_args: dict | None = None):
    """Append an action entry to the JSONL log."""
    entry = {
        "round": round_num,
        "timestamp": datetime.now().isoformat(),
        "platform": platform,
        "agent_id": agent_id,
        "agent_name": agent_name,
        "action_type": action_type,
        "action_args": action_args or {},
    }
    with open(log_path, "a") as f:
        f.write(json.dumps(entry) + "\n")


def load_profiles_for_platform(profiles: list[AgentProfile], platform: str, output_dir: Path) -> str:
    """Save profiles in OASIS-expected format and return the file path."""
    if platform == "twitter":
        csv_path = output_dir / "twitter_profiles.csv"
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["user_id", "name", "username", "user_char", "description"])
            for p in profiles:
                tw = p.to_twitter_format()
                writer.writerow([tw["user_id"], tw["name"], tw["username"], tw["user_char"], tw["description"]])
        return str(csv_path)
    else:
        json_path = output_dir / "reddit_profiles.json"
        json_path.write_text(json.dumps([p.to_reddit_format() for p in profiles], indent=2))
        return str(json_path)


def fetch_new_actions_from_db(db_path: str, last_rowid: int, agent_names: dict[int, str]) -> tuple[list[dict], int]:
    """Read new actions from OASIS SQLite database since last_rowid."""
    if not os.path.exists(db_path):
        return [], last_rowid

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.execute(
            "SELECT rowid, user_id, action, info, created_at FROM trace WHERE rowid > ? ORDER BY rowid",
            (last_rowid,)
        )
        actions = []
        new_last_rowid = last_rowid
        for row in cursor:
            new_last_rowid = row["rowid"]
            info = json.loads(row["info"]) if row["info"] else {}
            actions.append({
                "agent_id": row["user_id"],
                "agent_name": agent_names.get(row["user_id"], f"agent_{row['user_id']}"),
                "action_type": row["action"],
                "action_args": info,
            })
        return actions, new_last_rowid
    finally:
        conn.close()


async def run_platform(platform: str, config: SimulationConfig, profiles: list[AgentProfile],
                       sim_dir: Path, log_path: str, max_rounds: int | None = None):
    """Run simulation for a single platform."""
    from oasis import ActionType, LLMAction, ManualAction

    if platform == "twitter":
        from oasis import generate_twitter_agent_graph
        import oasis

        profile_path = load_profiles_for_platform(profiles, "twitter", sim_dir)
        db_path = str(sim_dir / "twitter_simulation.db")

        from camel.models import ModelFactory
        from camel.types import ModelPlatformType

        model = ModelFactory.create(
            model_platform=ModelPlatformType.DEFAULT,
            model_type=os.getenv("LLM_MODEL_NAME", "gpt-4o-mini"),
            url=os.getenv("LLM_BASE_URL", "http://localhost:11434/v1"),
            api_key=os.getenv("LLM_API_KEY", "ollama"),
        )

        available_actions = [
            ActionType.CREATE_POST, ActionType.LIKE_POST, ActionType.REPOST,
            ActionType.FOLLOW, ActionType.DO_NOTHING, ActionType.QUOTE_POST,
        ]

        agent_graph = await generate_twitter_agent_graph(
            profile_path=profile_path, model=model, available_actions=available_actions,
        )

        env = oasis.make(
            agent_graph=agent_graph,
            platform=oasis.DefaultPlatformType.TWITTER,
            database_path=db_path,
            semaphore=30,
        )
    else:
        from oasis import generate_reddit_agent_graph
        import oasis

        profile_path = load_profiles_for_platform(profiles, "reddit", sim_dir)
        db_path = str(sim_dir / "reddit_simulation.db")

        from camel.models import ModelFactory
        from camel.types import ModelPlatformType

        model = ModelFactory.create(
            model_platform=ModelPlatformType.DEFAULT,
            model_type=os.getenv("LLM_MODEL_NAME", "gpt-4o-mini"),
            url=os.getenv("LLM_BASE_URL", "http://localhost:11434/v1"),
            api_key=os.getenv("LLM_API_KEY", "ollama"),
        )

        available_actions = [
            ActionType.LIKE_POST, ActionType.DISLIKE_POST, ActionType.CREATE_POST,
            ActionType.CREATE_COMMENT, ActionType.DO_NOTHING, ActionType.FOLLOW,
        ]

        agent_graph = await generate_reddit_agent_graph(
            profile_path=profile_path, model=model, available_actions=available_actions,
        )

        env = oasis.make(
            agent_graph=agent_graph,
            platform=oasis.DefaultPlatformType.REDDIT,
            database_path=db_path,
            semaphore=30,
        )

    await env.reset()

    # Build agent name lookup
    agent_names = {p.user_id: p.name for p in profiles}

    # Seed initial posts
    for post in config.event_config.initial_posts:
        poster_id = post.get("poster_agent_id", 0)
        agent = agent_graph.get_agent(poster_id)
        if agent:
            manual = ManualAction(
                action_type=ActionType.CREATE_POST,
                action_args={"content": post["content"]},
            )
            await env.step({agent: manual})
            log_action(log_path, 0, platform, poster_id, agent_names.get(poster_id, "unknown"),
                       "CREATE_POST", {"content": post["content"]})

    # Main simulation loop
    tc = config.time_config
    total_rounds = max_rounds or tc.total_rounds
    last_rowid = 0

    for round_num in range(1, total_rounds + 1):
        simulated_minutes = round_num * tc.minutes_per_round
        simulated_hour = (simulated_minutes // 60) % 24

        multiplier = get_time_multiplier(tc, simulated_hour)
        active_ids = get_active_agents(config.agent_configs, simulated_hour, multiplier)

        if active_ids:
            actions = {}
            for aid in active_ids:
                agent = agent_graph.get_agent(aid)
                if agent:
                    actions[agent] = LLMAction()

            if actions:
                await env.step(actions)

        # Read new actions from OASIS db and log them
        new_actions, last_rowid = fetch_new_actions_from_db(db_path, last_rowid, agent_names)
        for action in new_actions:
            log_action(log_path, round_num, platform, action["agent_id"],
                       action["agent_name"], action["action_type"], action["action_args"])

        print(f"[{platform}] Round {round_num}/{total_rounds} (hour {simulated_hour}) — "
              f"{len(active_ids)} active, {len(new_actions)} actions", file=sys.stderr)

    return env, agent_graph


async def ipc_loop(sim_dir: Path, envs: dict, agent_graphs: dict, agent_names: dict, timeout: int = 600):
    """Listen for IPC commands (interviews) until timeout."""
    from oasis import ActionType, ManualAction

    server = IPCServer(str(sim_dir))
    last_activity = time.time()

    print(f"IPC server listening (timeout={timeout}s)...", file=sys.stderr)

    while time.time() - last_activity < timeout:
        cmd = server.poll_command()
        if cmd is None:
            await asyncio.sleep(1)
            continue

        last_activity = time.time()
        cmd_type = cmd.get("command_type")
        args = cmd.get("args", {})

        if cmd_type == CommandType.CLOSE_ENV.value:
            server.send_response(cmd["command_id"], {"status": "closing"})
            break

        if cmd_type == CommandType.INTERVIEW.value:
            agent_id = args["agent_id"]
            prompt = args.get("prompt", "What do you think?")
            platform = args.get("platform")
            results = {}

            platforms_to_query = [platform] if platform else list(envs.keys())
            for plat in platforms_to_query:
                if plat not in envs or plat not in agent_graphs:
                    continue
                agent = agent_graphs[plat].get_agent(agent_id)
                if not agent:
                    continue
                interview_action = ManualAction(
                    action_type=ActionType.INTERVIEW if hasattr(ActionType, "INTERVIEW") else ActionType.CREATE_POST,
                    action_args={"prompt": prompt},
                )
                await envs[plat].step({agent: interview_action})

                # Read response from db trace table
                db_name = f"{plat}_simulation.db"
                db_path = str(sim_dir / db_name)
                conn = __import__("sqlite3").connect(db_path)
                row = conn.execute(
                    "SELECT info FROM trace WHERE user_id = ? ORDER BY rowid DESC LIMIT 1",
                    (agent_id,)
                ).fetchone()
                conn.close()

                response_text = ""
                if row and row[0]:
                    info = json.loads(row[0])
                    response_text = info.get("response", info.get("content", str(info)))

                results[plat] = {
                    "agent_id": agent_id,
                    "agent_name": agent_names.get(agent_id, f"agent_{agent_id}"),
                    "response": response_text,
                }

            server.send_response(cmd["command_id"], {
                "agent_id": agent_id,
                "agent_name": agent_names.get(agent_id, f"agent_{agent_id}"),
                "platforms": results,
            })

    # Cleanup
    for env in envs.values():
        try:
            await env.close()
        except Exception:
            pass


async def async_main(config: SimulationConfig, profiles: list[AgentProfile],
                     sim_dir: Path, platform: str, max_rounds: int | None):
    """Main async entry point."""
    log_path = str(sim_dir / "actions.jsonl")
    agent_names = {p.user_id: p.name for p in profiles}

    envs = {}
    agent_graphs = {}

    if platform in ("twitter", "parallel"):
        env_tw, ag_tw = await run_platform("twitter", config, profiles, sim_dir, log_path, max_rounds)
        envs["twitter"] = env_tw
        agent_graphs["twitter"] = ag_tw

    if platform in ("reddit", "parallel"):
        env_rd, ag_rd = await run_platform("reddit", config, profiles, sim_dir, log_path, max_rounds)
        envs["reddit"] = env_rd
        agent_graphs["reddit"] = ag_rd

    # Write completion marker
    with open(log_path, "a") as f:
        f.write(json.dumps({"event": "simulation_complete", "timestamp": datetime.now().isoformat()}) + "\n")

    print("Simulation complete. Starting IPC server for interviews...", file=sys.stderr)

    # Enter IPC loop for interviews
    await ipc_loop(sim_dir, envs, agent_graphs, agent_names)


def main():
    parser = argparse.ArgumentParser(description="Run OASIS social simulation")
    parser.add_argument("--config", required=True, help="Path to simulation_config.json")
    parser.add_argument("--profiles", required=True, help="Path to profiles.json")
    parser.add_argument("--platform", default="parallel", choices=["twitter", "reddit", "parallel"])
    parser.add_argument("--max-rounds", type=int, default=None, help="Override max simulation rounds")
    args = parser.parse_args()

    config_data = json.loads(Path(args.config).read_text())
    config = SimulationConfig(**config_data)

    profiles_data = json.loads(Path(args.profiles).read_text())
    profiles = [AgentProfile(**p) for p in profiles_data]

    sim_dir = Path(args.config).parent

    asyncio.run(async_main(config, profiles, sim_dir, args.platform, args.max_rounds))


if __name__ == "__main__":
    main()
```

**Step 4: Run tests**

Run: `cd simulation && source .venv/bin/activate && python -m pytest tests/test_run_simulation.py -v`
Expected: All 3 tests PASS (unit tests only — no OASIS needed)

**Step 5: Commit**

```bash
git add simulation/src/run_simulation.py simulation/tests/test_run_simulation.py
git commit -m "feat(simulation): add OASIS simulation runner with IPC interview support"
```

---

### Task 7: Interview Client

**Files:**
- Create: `simulation/src/interview.py`
- Create: `simulation/tests/test_interview.py`

**Step 1: Write the test**

```python
# simulation/tests/test_interview.py
import json
import tempfile
import threading
import time
import pytest
from src.interview import interview_agent, interview_all
from src.ipc import IPCServer


def _mock_server(ipc_dir: str, response: dict):
    """Simulate a running simulation that responds to interviews."""
    server = IPCServer(ipc_dir)
    deadline = time.time() + 5
    while time.time() < deadline:
        cmd = server.poll_command()
        if cmd:
            server.send_response(cmd["command_id"], response)
            return
        time.sleep(0.1)


def test_interview_agent():
    with tempfile.TemporaryDirectory() as tmpdir:
        expected = {"agent_id": 3, "agent_name": "Mike", "platforms": {
            "twitter": {"agent_id": 3, "agent_name": "Mike", "response": "Buying more!"}
        }}
        t = threading.Thread(target=_mock_server, args=(tmpdir, expected))
        t.start()
        time.sleep(0.1)

        result = interview_agent(tmpdir, agent_id=3, prompt="Buy or sell?", timeout=5)
        t.join()
        assert result is not None
        assert result["agent_id"] == 3


def test_interview_agent_timeout():
    with tempfile.TemporaryDirectory() as tmpdir:
        result = interview_agent(tmpdir, agent_id=0, prompt="hi", timeout=1)
        assert result is None
```

**Step 2: Run test to verify it fails**

Run: `cd simulation && source .venv/bin/activate && python -m pytest tests/test_interview.py -v`
Expected: FAIL

**Step 3: Write interview.py**

```python
#!/usr/bin/env python3
"""Interview simulated agents in a running simulation via IPC."""

import argparse
import json
import sys
from pathlib import Path

from .ipc import IPCClient, CommandType


def interview_agent(sim_dir: str, agent_id: int, prompt: str,
                    platform: str | None = None, timeout: float = 60) -> dict | None:
    """Interview a single agent. Returns response dict or None on timeout."""
    client = IPCClient(sim_dir)
    cmd_id = client.send_command(CommandType.INTERVIEW, {
        "agent_id": agent_id,
        "prompt": prompt,
        "platform": platform,
    })
    return client.wait_response(cmd_id, timeout=timeout)


def interview_all(sim_dir: str, agent_ids: list[int], prompt: str,
                  platform: str | None = None, timeout: float = 120) -> list[dict]:
    """Interview multiple agents sequentially."""
    results = []
    for aid in agent_ids:
        result = interview_agent(sim_dir, aid, prompt, platform, timeout=timeout)
        if result:
            results.append(result)
    return results


def main():
    parser = argparse.ArgumentParser(description="Interview simulated agents")
    parser.add_argument("--sim-dir", required=True, help="Simulation directory")
    parser.add_argument("--agent-id", type=int, help="Specific agent ID to interview")
    parser.add_argument("--all", action="store_true", help="Interview all agents")
    parser.add_argument("--prompt", required=True, help="Interview question")
    parser.add_argument("--platform", default=None, choices=["twitter", "reddit"])
    parser.add_argument("--timeout", type=float, default=60)
    args = parser.parse_args()

    sim_dir = args.sim_dir

    if args.all:
        # Read profiles to get all agent IDs
        profiles_path = Path(sim_dir) / "profiles.json"
        if not profiles_path.exists():
            print("Error: profiles.json not found in sim dir", file=sys.stderr)
            sys.exit(1)
        profiles = json.loads(profiles_path.read_text())
        agent_ids = [p["user_id"] for p in profiles]
        results = interview_all(sim_dir, agent_ids, args.prompt, args.platform, args.timeout)
        print(json.dumps(results, indent=2))
    elif args.agent_id is not None:
        result = interview_agent(sim_dir, args.agent_id, args.prompt, args.platform, args.timeout)
        if result:
            print(json.dumps(result, indent=2))
        else:
            print("Error: interview timed out", file=sys.stderr)
            sys.exit(1)
    else:
        print("Error: specify --agent-id or --all", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
```

**Step 4: Run tests**

Run: `cd simulation && source .venv/bin/activate && python -m pytest tests/test_interview.py -v`
Expected: All 2 tests PASS

**Step 5: Commit**

```bash
git add simulation/src/interview.py simulation/tests/test_interview.py
git commit -m "feat(simulation): add IPC-based agent interview client"
```

---

### Task 8: Report Generation

**Files:**
- Create: `simulation/src/generate_report.py`
- Create: `simulation/tests/test_generate_report.py`

**Step 1: Write the test**

```python
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
```

**Step 2: Run test to verify it fails**

Run: `cd simulation && source .venv/bin/activate && python -m pytest tests/test_generate_report.py -v`
Expected: FAIL

**Step 3: Write generate_report.py**

```python
#!/usr/bin/env python3
"""Generate analysis report from simulation results using ReACT pattern."""

import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(Path(__file__).parent.parent / ".env")


def aggregate_actions(actions: list[dict]) -> dict:
    """Aggregate raw actions into summary statistics."""
    platform_counts: dict[str, int] = {}
    action_type_counts: dict[str, int] = {}
    agent_activity: dict[str, int] = {}
    posts: list[dict] = []
    total = 0
    max_round = 0

    for action in actions:
        if "event" in action:
            continue

        total += 1
        platform = action.get("platform", "unknown")
        platform_counts[platform] = platform_counts.get(platform, 0) + 1

        atype = action.get("action_type", "unknown")
        action_type_counts[atype] = action_type_counts.get(atype, 0) + 1

        aname = action.get("agent_name", f"agent_{action.get('agent_id', '?')}")
        agent_activity[aname] = agent_activity.get(aname, 0) + 1

        round_num = action.get("round", 0)
        if round_num > max_round:
            max_round = round_num

        if atype in ("CREATE_POST", "QUOTE_POST"):
            content = action.get("action_args", {}).get("content", "")
            if content:
                posts.append({
                    "agent": aname, "content": content,
                    "round": round_num, "platform": platform,
                })

    return {
        "total_actions": total,
        "total_rounds": max_round,
        "platform_counts": platform_counts,
        "action_type_counts": action_type_counts,
        "agent_activity": agent_activity,
        "posts": posts,
    }


REPORT_SYSTEM_PROMPT = """You are an expert market analyst generating a simulation report. You analyze how market sentiment propagated through a simulated social network and extract actionable trading signals.

Write in markdown. Be specific with data. Cite agent posts as evidence. Focus on what a trader can act on."""


def build_report_prompt(scenario: str, agg: dict) -> str:
    """Build the report generation prompt."""
    # Top posts by round (early vs late to show evolution)
    early_posts = [p for p in agg["posts"] if p["round"] <= agg["total_rounds"] // 3][:10]
    late_posts = [p for p in agg["posts"] if p["round"] > 2 * agg["total_rounds"] // 3][:10]

    early_text = "\n".join(f'- [{p["platform"]}] {p["agent"]}: "{p["content"][:200]}"' for p in early_posts)
    late_text = "\n".join(f'- [{p["platform"]}] {p["agent"]}: "{p["content"][:200]}"' for p in late_posts)

    top_agents = sorted(agg["agent_activity"].items(), key=lambda x: x[1], reverse=True)[:5]
    top_agents_text = "\n".join(f"- {name}: {count} actions" for name, count in top_agents)

    return f"""Analyze this social simulation and generate a trading signal report.

**Scenario:** {scenario}

**Simulation Stats:**
- Total actions: {agg['total_actions']} across {agg['total_rounds']} rounds
- Platforms: {json.dumps(agg['platform_counts'])}
- Action breakdown: {json.dumps(agg['action_type_counts'])}

**Most Active Agents:**
{top_agents_text}

**Early Posts (first third of simulation):**
{early_text or "No posts in early rounds"}

**Late Posts (last third of simulation):**
{late_text or "No posts in late rounds"}

**Total posts created:** {agg['action_type_counts'].get('CREATE_POST', 0)}
**Total likes:** {agg['action_type_counts'].get('LIKE_POST', 0)}
**Total reposts:** {agg['action_type_counts'].get('REPOST', 0) + agg['action_type_counts'].get('QUOTE_POST', 0)}

Generate a report with exactly these sections:

## Simulation Signal: [Topic]

**Scenario**: ...
**Agents**: ... participants across Twitter + Reddit
**Rounds**: ... rounds

### Sentiment Trajectory
- Analyze how sentiment shifted from early to late posts
- Start vs end distribution (bullish/bearish/neutral %)

### Propagation Analysis
- Dominant narrative and counter-narrative
- Consensus level and crowded trade risk
- Speed of narrative spread

### Key Voices
- Top 3-5 influential agents and what they said
- Who drove the narrative vs who pushed back

### Trading Implication
- Direction: BULLISH / BEARISH / MIXED with confidence %
- Entry, target, stop levels if directional
- Timing based on simulation timeline
- Key risk that could invalidate"""


def generate_report(scenario: str, agg: dict) -> str:
    """Generate report via LLM."""
    client = OpenAI(
        api_key=os.getenv("LLM_API_KEY", os.getenv("OPENAI_API_KEY", "ollama")),
        base_url=os.getenv("LLM_BASE_URL", os.getenv("OPENAI_BASE_URL", "http://localhost:11434/v1")),
    )
    model = os.getenv("LLM_MODEL_NAME", os.getenv("OPENAI_MODEL", "gpt-4o-mini"))

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": REPORT_SYSTEM_PROMPT},
            {"role": "user", "content": build_report_prompt(scenario, agg)},
        ],
        temperature=0.5,
    )

    return response.choices[0].message.content


def main():
    parser = argparse.ArgumentParser(description="Generate simulation report")
    parser.add_argument("--sim-dir", required=True, help="Simulation directory")
    parser.add_argument("--scenario", required=True, help="Market scenario description")
    args = parser.parse_args()

    sim_dir = Path(args.sim_dir)
    actions_path = sim_dir / "actions.jsonl"

    if not actions_path.exists():
        print("Error: actions.jsonl not found", file=sys.stderr)
        sys.exit(1)

    actions = [json.loads(line) for line in actions_path.read_text().strip().split("\n") if line.strip()]
    agg = aggregate_actions(actions)
    report = generate_report(args.scenario, agg)

    report_path = sim_dir / "report.md"
    report_path.write_text(report)
    print(f"Report generated → {report_path}", file=sys.stderr)

    # Also print to stdout for the agent to read
    print(report)


if __name__ == "__main__":
    main()
```

**Step 4: Run tests**

Run: `cd simulation && source .venv/bin/activate && python -m pytest tests/test_generate_report.py -v`
Expected: All 2 tests PASS

**Step 5: Commit**

```bash
git add simulation/src/generate_report.py simulation/tests/test_generate_report.py
git commit -m "feat(simulation): add ReACT-based report generation from actions"
```

---

### Task 9: Trader Skill

**Files:**
- Modify: `skills/trader/market-sentiment-simulator/skill.md` (replace existing MiroFish-based skill)

**Step 1: Replace the skill file**

Replace the entire contents of `skills/trader/market-sentiment-simulator/skill.md` with the new native workflow that uses `simulation/src/` scripts instead of MiroFish API calls. The skill should:

- List triggers: simulate, simulation, sentiment, swarm, crowd, what if, counterfactual, how will market react
- Step-by-step shell commands using the Python scripts
- Completion detection: grep for `simulation_complete` in actions.jsonl
- Output format: the standard report template
- Notes: must have Python venv set up at `simulation/.venv`

**Step 2: Verify skill format**

Run: `head -10 skills/trader/market-sentiment-simulator/skill.md`
Expected: Valid YAML frontmatter with name, description, triggers

**Step 3: Commit**

```bash
git add skills/trader/market-sentiment-simulator/skill.md
git commit -m "feat(simulation): update trader skill to use native simulation package"
```

---

### Task 10: conftest and Test Infrastructure

**Files:**
- Create: `simulation/tests/__init__.py`
- Create: `simulation/tests/conftest.py`

**Step 1: Create test infrastructure**

```python
# simulation/tests/__init__.py
```

```python
# simulation/tests/conftest.py
import sys
from pathlib import Path

# Add src to path so tests can import from src.*
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
```

**Step 2: Run all tests**

Run: `cd simulation && source .venv/bin/activate && python -m pytest tests/ -v`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add simulation/tests/__init__.py simulation/tests/conftest.py
git commit -m "chore(simulation): add test infrastructure"
```

---

### Task 11: Integration Smoke Test

**Files:**
- Create: `simulation/tests/test_integration.py`

**Step 1: Write integration test** (requires LLM — skipped in CI)

```python
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
         "action_type": "CREATE_POST", "action_args": {"content": "YOLO NVDA 200c lets gooo 🚀🚀🚀"}},
        {"event": "simulation_complete"},
    ]
    agg = aggregate_actions(actions)
    report = generate_report("NVDA beats earnings by 20%", agg)
    assert "Simulation Signal" in report or "Signal" in report
    assert len(report) > 200
```

**Step 2: Run unit tests (no LLM needed)**

Run: `cd simulation && source .venv/bin/activate && python -m pytest tests/ -v --ignore=tests/test_integration.py`
Expected: All unit tests PASS

**Step 3: Run integration tests (if LLM available)**

Run: `cd simulation && source .venv/bin/activate && LLM_API_KEY=$OPENAI_API_KEY python -m pytest tests/test_integration.py -v -s`
Expected: All 3 integration tests PASS (or skipped if no key)

**Step 4: Commit**

```bash
git add simulation/tests/test_integration.py
git commit -m "test(simulation): add integration smoke tests"
```
