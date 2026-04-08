# simulation/tests/test_ipc.py
import json
import os
import tempfile
import time
import threading
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


def test_poll_all_commands():
    """poll_all_commands drains all pending commands at once."""
    with tempfile.TemporaryDirectory() as tmpdir:
        server = IPCServer(tmpdir)
        client = IPCClient(tmpdir)

        # Send 3 commands
        ids = []
        for i in range(3):
            ids.append(client.send_command(CommandType.INTERVIEW, {"agent_id": i, "prompt": "hi"}))

        # Poll all at once
        commands = server.poll_all_commands()
        assert len(commands) == 3
        got_ids = {c["args"]["agent_id"] for c in commands}
        assert got_ids == {0, 1, 2}

        # Queue should now be empty
        assert server.poll_all_commands() == []


def test_poll_all_commands_empty():
    with tempfile.TemporaryDirectory() as tmpdir:
        server = IPCServer(tmpdir)
        assert server.poll_all_commands() == []


def test_wait_responses_concurrent():
    """wait_responses collects multiple responses in parallel."""
    with tempfile.TemporaryDirectory() as tmpdir:
        server = IPCServer(tmpdir)
        client = IPCClient(tmpdir)

        # Send 3 commands
        cmd_ids = []
        for i in range(3):
            cmd_ids.append(client.send_command(CommandType.INTERVIEW, {"agent_id": i, "prompt": "hi"}))

        # Server responds to all (simulating concurrent processing)
        def respond():
            time.sleep(0.2)
            for cmd_path in sorted(Path(tmpdir, "ipc_commands").glob("*.json")):
                cmd = json.loads(cmd_path.read_text())
                cmd_path.unlink()
                server.send_response(cmd["command_id"], {
                    "agent_id": cmd["args"]["agent_id"],
                    "agent_name": f"agent_{cmd['args']['agent_id']}",
                })

        t = threading.Thread(target=respond)
        t.start()

        results = client.wait_responses(cmd_ids, timeout=5)
        t.join()

        assert len(results) == 3
        assert all(r is not None for r in results)
        got_ids = {r["agent_id"] for r in results}
        assert got_ids == {0, 1, 2}


def test_wait_responses_partial_timeout():
    """wait_responses returns None for commands that time out."""
    with tempfile.TemporaryDirectory() as tmpdir:
        server = IPCServer(tmpdir)
        client = IPCClient(tmpdir)

        cmd_ids = []
        for i in range(3):
            cmd_ids.append(client.send_command(CommandType.INTERVIEW, {"agent_id": i, "prompt": "hi"}))

        # Only respond to the first command
        cmds = server.poll_all_commands()
        server.send_response(cmds[0]["command_id"], {"agent_id": cmds[0]["args"]["agent_id"]})

        results = client.wait_responses(cmd_ids, timeout=1.5)
        assert len(results) == 3
        # One succeeded, two timed out
        non_none = [r for r in results if r is not None]
        assert len(non_none) == 1
