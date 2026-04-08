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

    def poll_all_commands(self) -> list[dict]:
        """Drain all pending commands at once (oldest first)."""
        cmd_files = sorted(self.commands_dir.glob("*.json"))
        commands = []
        for cmd_path in cmd_files:
            try:
                cmd = json.loads(cmd_path.read_text())
                cmd_path.unlink()
                commands.append(cmd)
            except (json.JSONDecodeError, FileNotFoundError):
                continue
        return commands

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

    def wait_responses(self, command_ids: list[str], timeout: float = 120) -> list[dict | None]:
        """Wait for multiple responses concurrently. Returns results in same order as command_ids."""
        results: dict[str, dict | None] = {cid: None for cid in command_ids}
        deadline = time.time() + timeout

        while time.time() < deadline:
            all_done = True
            for cid in command_ids:
                if results[cid] is not None:
                    continue
                resp_path = self.responses_dir / f"{cid}.json"
                if resp_path.exists():
                    try:
                        data = json.loads(resp_path.read_text())
                        resp_path.unlink()
                        results[cid] = data.get("result")
                    except (json.JSONDecodeError, FileNotFoundError):
                        all_done = False
                else:
                    all_done = False
            if all_done:
                break
            time.sleep(0.5)

        return [results[cid] for cid in command_ids]
