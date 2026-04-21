#!/usr/bin/env python3
"""Run OASIS social simulation. Writes actions.jsonl and stays alive for IPC interviews.

Fixed bugs:
- BUG#1: Seed posts now logged as lowercase "create_post" (consistent with OASIS)
- BUG#2: quote_post actions enriched with content from OASIS post table
- BUG#3: Dead zone fix — simulation starts at first agent's active hour, not hour 0
"""

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
from .llm import get_camel_model

# Web search tool for agents (optional)
_web_search_factory = None
_web_search_round_setter = None  # function to update current round for search logging

# Fact-check configuration — defaults to ON since simulation agents hallucinate
# prices, catalysts, and earnings numbers that never appeared in the scenario.
# Opt out with --no-fact-check.
_fact_check_enabled = True
_fact_check_rate = 1.0

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


def compute_start_hour(agent_configs: list[dict]) -> int:
    """FIX#3: Find the earliest hour when ANY agent is active.

    Instead of starting at hour 0 (midnight) where no one is online,
    start at the earliest active hour across all agents.
    """
    earliest = 24
    for ac in agent_configs:
        hours = ac.get("active_hours", list(range(24)))
        if hours:
            earliest = min(earliest, min(hours))
    # Default to 7 AM if nothing found
    return earliest if earliest < 24 else 7


def log_action(log_path: str, round_num: int, platform: str, agent_id: int,
               agent_name: str, action_type: str, action_args: dict | None = None,
               extras: dict | None = None):
    """Append an action entry to the JSONL log.

    FIX#1: action_type is always stored lowercase for consistency.
    `extras` carries per-action metadata attached post-hoc — currently the
    fact_check verdict — so downstream tools (generate_report) can surface it.
    """
    entry = {
        "round": round_num,
        "timestamp": datetime.now().isoformat(),
        "platform": platform,
        "agent_id": agent_id,
        "agent_name": agent_name,
        "action_type": action_type.lower(),  # FIX#1: always lowercase
        "action_args": action_args or {},
    }
    if extras:
        for k, v in extras.items():
            if v is not None:
                entry[k] = v
    with open(log_path, "a") as f:
        f.write(json.dumps(entry) + "\n")


def load_profiles_for_platform(profiles: list[AgentProfile], platform: str, output_dir: Path,
                               scenario: str = "", context: str = "") -> str:
    """Save profiles in OASIS-expected format and return the file path."""
    if platform == "twitter":
        csv_path = output_dir / "twitter_profiles.csv"
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["user_id", "name", "username", "user_char", "description"])
            for p in profiles:
                tw = p.to_twitter_format(scenario=scenario, context=context)
                writer.writerow([tw["user_id"], tw["name"], tw["username"], tw["user_char"], tw["description"]])
        return str(csv_path)
    else:
        json_path = output_dir / "reddit_profiles.json"
        json_path.write_text(json.dumps([p.to_reddit_format() for p in profiles], indent=2))
        return str(json_path)


def _enrich_quote_actions(actions: list[dict], db_path: str) -> list[dict]:
    """FIX#2: Enrich quote_post actions with actual content from OASIS post table.

    The OASIS trace table only stores {quoted_id, new_post_id} for quotes.
    The actual quote text lives in the post table's quote_content column.
    """
    if not os.path.exists(db_path):
        return actions

    # Build post content map from DB
    post_map = {}
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT post_id, content, quote_content FROM post").fetchall()
        for row in rows:
            post_map[row["post_id"]] = {
                "content": row["content"] or "",
                "quote_content": row["quote_content"] or "",
            }
        conn.close()
    except Exception:
        return actions

    enriched = []
    for action in actions:
        if action.get("action_type", "").lower() == "quote_post":
            new_post_id = action.get("action_args", {}).get("new_post_id")
            if new_post_id and new_post_id in post_map:
                pm = post_map[new_post_id]
                action = dict(action)  # copy
                action["action_args"] = dict(action.get("action_args", {}))
                action["action_args"]["quote_content"] = pm["quote_content"]
                action["action_args"]["original_content"] = pm["content"]
        enriched.append(action)
    return enriched


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
                "action_type": row["action"],  # already lowercase from OASIS
                "action_args": info,
            })
        return actions, new_last_rowid
    finally:
        conn.close()


async def run_platform(platform: str, config: SimulationConfig, profiles: list[AgentProfile],
                       sim_dir: Path, log_path: str, max_rounds: int | None = None,
                       context: str = ""):
    """Run simulation for a single platform."""
    from oasis import ActionType, LLMAction, ManualAction

    model = get_camel_model()

    if platform == "twitter":
        from oasis import generate_twitter_agent_graph
        import oasis

        profile_path = load_profiles_for_platform(profiles, "twitter", sim_dir, scenario=config.scenario, context=context)
        db_path = str(sim_dir / "twitter_simulation.db")

        available_actions = [
            ActionType.CREATE_POST, ActionType.LIKE_POST, ActionType.REPOST,
            ActionType.FOLLOW, ActionType.DO_NOTHING, ActionType.QUOTE_POST,
        ]

        agent_graph = await generate_twitter_agent_graph(
            profile_path=profile_path, model=model, available_actions=available_actions,
            tool_factory=_web_search_factory,
        )

        # FIX#4: Custom Platform with increased rec visibility
        # Default was refresh_rec_post_count=2, max_rec_post_len=2
        # Agents only saw ~5% of posts. Now they see ~30-50%.
        from oasis.social_platform.platform import Platform
        from oasis.social_platform.channel import Channel as OasisChannel

        twitter_channel = OasisChannel()
        twitter_platform = Platform(
            db_path=db_path,
            channel=twitter_channel,
            recsys_type="twhin-bert",
            refresh_rec_post_count=10,   # was 2 → agents see 10 rec posts
            max_rec_post_len=20,         # was 2 → buffer holds 20 posts
            following_post_count=10,     # was 3 → see 10 from followed users
        )

        env = oasis.make(
            agent_graph=agent_graph,
            platform=twitter_platform,
            database_path=db_path,
            semaphore=10,
        )
    else:
        from oasis import generate_reddit_agent_graph
        import oasis

        profile_path = load_profiles_for_platform(profiles, "reddit", sim_dir, scenario=config.scenario, context=context)
        db_path = str(sim_dir / "reddit_simulation.db")

        available_actions = [
            ActionType.LIKE_POST, ActionType.DISLIKE_POST, ActionType.CREATE_POST,
            ActionType.CREATE_COMMENT, ActionType.DO_NOTHING, ActionType.FOLLOW,
        ]

        agent_graph = await generate_reddit_agent_graph(
            profile_path=profile_path, model=model, available_actions=available_actions,
        )

        # FIX#4: Custom Platform with increased rec visibility
        from oasis.social_platform.platform import Platform
        from oasis.social_platform.channel import Channel as OasisChannel

        reddit_channel = OasisChannel()
        reddit_platform = Platform(
            db_path=db_path,
            channel=reddit_channel,
            recsys_type="reddit",
            allow_self_rating=True,
            show_score=True,
            max_rec_post_len=50,          # was 100 (keep high for reddit)
            refresh_rec_post_count=15,    # was 5 → see more posts
        )

        env = oasis.make(
            agent_graph=agent_graph,
            platform=reddit_platform,
            database_path=db_path,
            semaphore=10,
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
            # FIX#1: Log as lowercase "create_post" for consistency
            log_action(log_path, 0, platform, poster_id, agent_names.get(poster_id, "unknown"),
                       "create_post", {"content": post["content"]})

    # FIX#3: Compute start hour from agent configs
    start_hour = compute_start_hour(config.agent_configs)

    # Main simulation loop
    tc = config.time_config
    total_rounds = max_rounds or tc.total_rounds
    last_rowid = 0

    for round_num in range(1, total_rounds + 1):
        # Update web search round tracker so searches log correct round
        if _web_search_round_setter:
            _web_search_round_setter(round_num)
        # FIX#3: Offset simulated time so round 1 starts at first active hour
        simulated_minutes = round_num * tc.minutes_per_round
        simulated_hour = ((start_hour * 60 + simulated_minutes) // 60) % 24

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

        # FIX#2: Enrich quote_post actions with content from post table
        new_actions = _enrich_quote_actions(new_actions, db_path)

        # Fact-check posts from agents who didn't search this round
        if _fact_check_enabled:
            from .tools.fact_check import has_verifiable_content, fact_check_post
            from .tools.web_search import agent_searched_this_round
            fc_count = 0
            for action in new_actions:
                atype = (action.get("action_type") or "").lower()
                if atype not in ("create_post", "quote_post"):
                    continue
                aid = action.get("agent_id", -1)
                if agent_searched_this_round(aid):
                    continue
                content = (action.get("action_args") or {}).get("content", "")
                if not content or not has_verifiable_content(content):
                    continue
                if random.random() > _fact_check_rate:
                    continue
                fc_result = fact_check_post(content)
                if fc_result:
                    action["fact_check"] = fc_result
                    fc_count += 1
            if fc_count:
                print(f"  [{platform}] Fact-checked {fc_count} posts in round {round_num}", file=sys.stderr)

        for action in new_actions:
            extras = {"fact_check": action.get("fact_check")} if action.get("fact_check") else None
            log_action(log_path, round_num, platform, action["agent_id"],
                       action["agent_name"], action["action_type"], action["action_args"],
                       extras=extras)

        print(f"[{platform}] Round {round_num}/{total_rounds} (hour {simulated_hour}, "
              f"t+{simulated_minutes}min) — "
              f"{len(active_ids)} active, {len(new_actions)} actions", file=sys.stderr)

    return env, agent_graph


async def _handle_interview(cmd: dict, sim_dir: Path, envs: dict, agent_graphs: dict,
                            agent_names: dict, server: IPCServer):
    """Handle a single interview command. Safe to run concurrently with others."""
    from oasis import ActionType, ManualAction

    args = cmd.get("args", {})
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
        conn = sqlite3.connect(db_path)
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


async def ipc_loop(sim_dir: Path, envs: dict, agent_graphs: dict, agent_names: dict, timeout: int = 600):
    """Listen for IPC commands (interviews) until timeout.

    Drains all pending commands each tick and processes interviews concurrently
    using asyncio.gather so multiple agents can answer in parallel.
    """
    server = IPCServer(str(sim_dir))
    last_activity = time.time()

    print(f"IPC server listening (timeout={timeout}s)...", file=sys.stderr)

    while time.time() - last_activity < timeout:
        commands = server.poll_all_commands()
        if not commands:
            await asyncio.sleep(1)
            continue

        last_activity = time.time()

        # Separate close commands from interview commands
        close_requested = False
        interview_cmds = []

        for cmd in commands:
            cmd_type = cmd.get("command_type")
            if cmd_type == CommandType.CLOSE_ENV.value:
                server.send_response(cmd["command_id"], {"status": "closing"})
                close_requested = True
            elif cmd_type == CommandType.INTERVIEW.value:
                interview_cmds.append(cmd)
            elif cmd_type == CommandType.BATCH_INTERVIEW.value:
                # Expand batch into individual interview commands
                args = cmd.get("args", {})
                agent_ids = args.get("agent_ids", [])
                prompt = args.get("prompt", "What do you think?")
                platform = args.get("platform")
                for aid in agent_ids:
                    interview_cmds.append({
                        "command_id": f"{cmd['command_id']}__{aid}",
                        "command_type": CommandType.INTERVIEW.value,
                        "args": {"agent_id": aid, "prompt": prompt, "platform": platform},
                    })
                # Also send a batch-level response with the sub-command ids
                server.send_response(cmd["command_id"], {
                    "status": "expanded",
                    "sub_command_ids": [f"{cmd['command_id']}__{aid}" for aid in agent_ids],
                })

        # Run all interview commands concurrently
        if interview_cmds:
            n = len(interview_cmds)
            aids = [c["args"]["agent_id"] for c in interview_cmds]
            print(f"  [IPC] Processing {n} interview(s) concurrently: agents {aids}", file=sys.stderr)
            await asyncio.gather(*(
                _handle_interview(cmd, sim_dir, envs, agent_graphs, agent_names, server)
                for cmd in interview_cmds
            ))

        if close_requested:
            break

    # Cleanup
    for env in envs.values():
        try:
            await env.close()
        except Exception:
            pass


async def async_main(config: SimulationConfig, profiles: list[AgentProfile],
                     sim_dir: Path, platform: str, max_rounds: int | None,
                     context_file: str | None = None,
                     web_search: bool = False, max_searches_per_agent: int = 3,
                     fact_check: bool = False, fact_check_rate: float = 1.0):
    """Main async entry point."""
    log_path = str(sim_dir / "actions.jsonl")
    agent_names = {p.user_id: p.name for p in profiles}

    context = ""
    if context_file and os.path.exists(context_file):
        context = Path(context_file).read_text()

    # Setup web search tool for agents if enabled
    global _web_search_factory
    if web_search:
        from .tools.web_search import make_tool_factory, set_current_round, set_lead_agents
        agent_name_map = {p.user_id: p.name for p in profiles}
        _web_search_factory = make_tool_factory(
            max_searches_per_agent=max_searches_per_agent,
            log_path=log_path,
            agent_names=agent_name_map,
        )
        # Give lead analysts 2x search limit
        lead_ids = [p.user_id for p in profiles if p.archetype == "lead_analyst"]
        if lead_ids:
            set_lead_agents(lead_ids)
            print(f"📊 Lead analysts: {lead_ids} (2x search limit)", file=sys.stderr)
        global _web_search_round_setter
        _web_search_round_setter = set_current_round
        print(f"🔍 Web search ENABLED: {max_searches_per_agent} searches per agent, max_iteration=3", file=sys.stderr)
    else:
        _web_search_factory = None

    # Setup fact-checking if enabled
    global _fact_check_enabled, _fact_check_rate
    _fact_check_enabled = fact_check
    _fact_check_rate = fact_check_rate
    if fact_check:
        from .tools.fact_check import reset_cache
        reset_cache()
        print(f"✓✗ Fact-check ENABLED: rate={fact_check_rate}", file=sys.stderr)

    envs = {}
    agent_graphs = {}

    if platform in ("twitter", "parallel"):
        env_tw, ag_tw = await run_platform("twitter", config, profiles, sim_dir, log_path, max_rounds, context=context)
        envs["twitter"] = env_tw
        agent_graphs["twitter"] = ag_tw

    if platform in ("reddit", "parallel"):
        env_rd, ag_rd = await run_platform("reddit", config, profiles, sim_dir, log_path, max_rounds, context=context)
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
    parser.add_argument("--context-file", default=None, help="Path to context.md with raw market data")
    parser.add_argument("--web-search", action="store_true", help="Enable Nova web search tool for agents")
    parser.add_argument("--max-searches-per-agent", type=int, default=5, help="Max web searches per agent (default: 3)")
    parser.add_argument("--fact-check", action=argparse.BooleanOptionalAction, default=True,
                        help="Automatic fact-checking of agent posts (default: on). Use --no-fact-check to disable.")
    parser.add_argument("--fact-check-rate", type=float, default=1.0, help="Fraction of posts to fact-check (0.0-1.0, default: 1.0)")
    args = parser.parse_args()

    config_data = json.loads(Path(args.config).read_text())
    config = SimulationConfig(**config_data)

    profiles_data = json.loads(Path(args.profiles).read_text())
    profiles = [AgentProfile(**p) for p in profiles_data]

    sim_dir = Path(args.config).parent

    asyncio.run(async_main(config, profiles, sim_dir, args.platform, args.max_rounds,
                           args.context_file, args.web_search, args.max_searches_per_agent,
                           args.fact_check, args.fact_check_rate))


if __name__ == "__main__":
    main()
