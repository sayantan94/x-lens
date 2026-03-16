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
from .llm import get_camel_model

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

    model = get_camel_model()

    if platform == "twitter":
        from oasis import generate_twitter_agent_graph
        import oasis

        profile_path = load_profiles_for_platform(profiles, "twitter", sim_dir)
        db_path = str(sim_dir / "twitter_simulation.db")

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
