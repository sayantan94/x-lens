#!/usr/bin/env python3
"""Generate analysis report from simulation results using ReACT pattern.

Fixed bugs:
- BUG#1: Case-insensitive action_type matching (OASIS logs lowercase, seeds uppercase)
- BUG#2: Quote content read from OASIS post table (trace only has quoted_id/new_post_id)
"""

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

from .llm import completion


def _load_post_content_from_db(sim_dir: Path) -> dict[int, dict]:
    """Load post content (including quote_content) from OASIS SQLite DB.

    Returns {post_id: {"content": ..., "quote_content": ..., "user_id": ...}}
    """
    post_map = {}
    for db_name in ("twitter_simulation.db", "reddit_simulation.db"):
        db_path = sim_dir / db_name
        if not db_path.exists():
            continue
        try:
            conn = sqlite3.connect(str(db_path))
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT post_id, user_id, content, quote_content FROM post"
            ).fetchall()
            for row in rows:
                post_map[row["post_id"]] = {
                    "content": row["content"] or "",
                    "quote_content": row["quote_content"] or "",
                    "user_id": row["user_id"],
                }
            conn.close()
        except Exception as e:
            print(f"Warning: could not read {db_name}: {e}", file=sys.stderr)
    return post_map


def aggregate_actions(actions: list[dict], sim_dir: Path | None = None) -> dict:
    """Aggregate raw actions into summary statistics.

    FIX#1: Case-insensitive action_type matching.
    FIX#2: For quote_post, fetch content from OASIS post table via new_post_id.
    """
    # Load post content from DB for quote resolution
    post_map = {}
    if sim_dir:
        post_map = _load_post_content_from_db(sim_dir)

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

        # FIX#1: Normalize action_type to lowercase for consistent counting
        atype = action.get("action_type", "unknown").lower()
        action_type_counts[atype] = action_type_counts.get(atype, 0) + 1

        aname = action.get("agent_name", f"agent_{action.get('agent_id', '?')}")
        agent_activity[aname] = agent_activity.get(aname, 0) + 1

        round_num = action.get("round", 0)
        if round_num > max_round:
            max_round = round_num

        # FIX#1: Case-insensitive post detection
        if atype in ("create_post", "quote_post"):
            content = ""
            args = action.get("action_args", {})

            if atype == "create_post":
                content = args.get("content", "")
            elif atype == "quote_post":
                # FIX#2: Quote content is in the post table, not in trace args
                new_post_id = args.get("new_post_id")
                if new_post_id and new_post_id in post_map:
                    pm = post_map[new_post_id]
                    # quote_content has the agent's commentary; content is the
                    # original post being quoted — show both
                    quote_text = pm.get("quote_content", "")
                    orig_text = pm.get("content", "")
                    if quote_text:
                        content = f"[QT] {quote_text}"
                        if orig_text:
                            content += f" | Re: {orig_text[:100]}"
                    elif orig_text:
                        content = f"[Requote] {orig_text}"

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

Write in markdown. Be specific with data. Cite agent posts as evidence. Focus on what a trader can act on.

CRITICAL RULES:
1. Base your sentiment analysis ONLY on the actual post content provided — do NOT infer "narrative decay" from absence of data.
2. Count bullish vs bearish posts across ALL rounds (early, mid, late) to determine sentiment trajectory.
3. If agents fabricate price movements or events not in the original scenario, note this as "agent hallucination" and discount those posts.
4. Quote-tweets ([QT]) represent engagement/debate — more QTs = more active conversation, NOT decay.
5. The simulation is synthetic — agents cannot know future prices. Any specific price predictions are LLM fabrication."""


def build_report_prompt(scenario: str, agg: dict) -> str:
    """Build the report generation prompt."""
    total_rounds = agg["total_rounds"]
    third = max(total_rounds // 3, 1)

    # Posts by phase
    early_posts = [p for p in agg["posts"] if p["round"] <= third]
    mid_posts = [p for p in agg["posts"] if third < p["round"] <= 2 * third]
    late_posts = [p for p in agg["posts"] if p["round"] > 2 * third]

    def fmt_posts(plist, limit=15):
        return "\n".join(
            f'- R{p["round"]} [{p["platform"]}] {p["agent"]}: "{p["content"][:250]}"'
            for p in plist[:limit]
        ) or "No posts in this phase"

    top_agents = sorted(agg["agent_activity"].items(), key=lambda x: x[1], reverse=True)[:7]
    top_agents_text = "\n".join(f"- {name}: {count} actions" for name, count in top_agents)

    return f"""Analyze this social simulation and generate a trading signal report.

**Scenario:** {scenario}

**Simulation Stats:**
- Total actions: {agg['total_actions']} across {agg['total_rounds']} rounds
- Platforms: {json.dumps(agg['platform_counts'])}
- Action breakdown: {json.dumps(agg['action_type_counts'])}
- **Total original posts: {agg['action_type_counts'].get('create_post', 0)}**
- **Total quote-tweets: {agg['action_type_counts'].get('quote_post', 0)}**
- **Total likes: {agg['action_type_counts'].get('like_post', 0)}**
- **Total reposts: {agg['action_type_counts'].get('repost', 0)}**

**Most Active Agents:**
{top_agents_text}

**EARLY posts (rounds 1-{third}, {len(early_posts)} posts):**
{fmt_posts(early_posts)}

**MID posts (rounds {third+1}-{2*third}, {len(mid_posts)} posts):**
{fmt_posts(mid_posts)}

**LATE posts (rounds {2*third+1}-{total_rounds}, {len(late_posts)} posts):**
{fmt_posts(late_posts)}

IMPORTANT: Count EVERY post above and classify each as BULLISH, BEARISH, or NEUTRAL.
Report the exact counts: "Early: X bull / Y bear / Z neutral, Mid: ..., Late: ..."
If late posts exist, do NOT say "narrative decay" — analyze the actual content.
If agents cite prices not in the scenario data ($124.87 close), flag as hallucination.

Generate a report with exactly these sections:

## Simulation Signal: [Topic]

**Scenario**: ...
**Agents**: ... participants across [platforms]
**Rounds**: ... rounds ({len(agg['posts'])} substantive posts)

### 🐂 Bull Thesis
- Summarize the bull case using ONLY facts cited by agents (with web search sources)
- List every data point supporting the bull case: price levels, analyst targets, earnings beats, macro indicators
- Note which agents made these arguments and whether they used web search to verify
- Entry point, target, and stop loss based on the evidence

### 🐻 Bear Thesis
- Summarize the bear case using ONLY facts cited by agents (with web search sources)
- List every data point supporting the bear case: risks, downgrades, macro headwinds, technical breakdowns
- Note which agents made these arguments and whether they used web search to verify
- Downside target, hedge recommendation

### Thesis Quality Assessment
- How many agents used web search? (fact-based posts vs opinion-only posts)
- Did any agent fabricate data? Flag hallucinated prices or events.
- Were the bull/bear leads' theses supported by real data?
- Strength of evidence: rate each thesis 1-5 based on source quality and specificity

### Verdict
- **Direction**: BULLISH / BEARISH / NEUTRAL with confidence 0-100%
- **Bull evidence strength**: [strong/moderate/weak] — cite top 3 facts
- **Bear evidence strength**: [strong/moderate/weak] — cite top 3 facts
- **Recommended action**: specific entry, stop, target OR "no trade — insufficient edge"
- **Key risk**: the single fact that could flip the verdict
- **Time horizon**: how long this thesis is valid

### Sentiment Flow
- Count posts by phase: Early/Mid/Late × Bull/Bear/Neutral
- Start vs end sentiment shift
- Did the thesis rounds change anyone's mind?

### Key Voices
- Top 5 agents by influence and their stance (cite actual posts with data)
- Who brought real facts vs who repeated opinions"""


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

    # FIX: Pass sim_dir so we can read quote content from OASIS DB
    agg = aggregate_actions(actions, sim_dir=sim_dir)
    report = generate_report(args.scenario, agg)

    report_path = sim_dir / "report.md"
    report_path.write_text(report)
    print(f"Report generated → {report_path}", file=sys.stderr)

    # Also print to stdout for the agent to read
    print(report)


if __name__ == "__main__":
    main()
