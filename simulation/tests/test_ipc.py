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
