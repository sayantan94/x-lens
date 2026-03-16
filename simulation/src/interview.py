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
