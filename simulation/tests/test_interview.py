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
