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
