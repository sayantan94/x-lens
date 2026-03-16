#!/usr/bin/env python3
"""Generate analysis report from simulation results using ReACT pattern."""

import argparse
import json
import os
import sys
from pathlib import Path

from .llm import completion


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
    return completion(
        messages=[
            {"role": "system", "content": REPORT_SYSTEM_PROMPT},
            {"role": "user", "content": build_report_prompt(scenario, agg)},
        ],
        temperature=0.5,
    )


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
