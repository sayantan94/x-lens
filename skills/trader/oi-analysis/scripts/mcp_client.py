"""
Lightweight MCP stdio JSON-RPC client for calling MCP servers.
Spawns the server as a subprocess, communicates via stdin/stdout.
"""

import asyncio
import json
import sys
from typing import Any, Dict, List, Optional


class MCPClient:
    """MCP stdio JSON-RPC 2.0 client."""

    def __init__(self, cmd: str, args: Optional[List[str]] = None):
        self.cmd = cmd
        self.args = args or []
        self.proc: Optional[asyncio.subprocess.Process] = None
        self.req_id = 0
        self.initialized = False

    async def start(self) -> None:
        self.proc = await asyncio.create_subprocess_exec(
            self.cmd, *self.args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=100 * 1024 * 1024,  # 100MB buffer
        )
        await self._initialize()

    async def stop(self) -> None:
        if self.proc and self.proc.returncode is None:
            self.proc.terminate()
            try:
                await asyncio.wait_for(self.proc.wait(), timeout=5)
            except asyncio.TimeoutError:
                self.proc.kill()

    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Call an MCP tool and return parsed result."""
        self._assert_ready()
        resp = await self._rpc("tools/call", {"name": name, "arguments": arguments})
        content = resp.get("result", {}).get("content", [])
        if isinstance(content, list) and content and isinstance(content[0], dict) and "text" in content[0]:
            try:
                return json.loads(content[0]["text"])
            except json.JSONDecodeError:
                return {"raw_text": content[0]["text"]}
        return resp

    async def list_tools(self) -> List[Dict[str, Any]]:
        """List available tools on the server."""
        self._assert_ready()
        resp = await self._rpc("tools/list", {})
        return resp.get("result", {}).get("tools", [])

    async def _initialize(self) -> None:
        await self._rpc("initialize", {
            "protocolVersion": "0.1.0",
            "capabilities": {},
            "clientInfo": {"name": "x-lens-oi", "version": "1.0.0"},
        })
        await self._send({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})
        self.initialized = True

    async def _rpc(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        self.req_id += 1
        await self._send({"jsonrpc": "2.0", "id": self.req_id, "method": method, "params": params})
        line = await self._readline()
        return json.loads(line)

    async def _send(self, obj: Dict[str, Any]) -> None:
        assert self.proc and self.proc.stdin
        data = (json.dumps(obj) + "\n").encode("utf-8")
        self.proc.stdin.write(data)
        await self.proc.stdin.drain()

    async def _readline(self) -> str:
        assert self.proc and self.proc.stdout
        line = await self.proc.stdout.readline()
        if not line:
            err = ""
            if self.proc.stderr:
                err = (await self.proc.stderr.read()).decode(errors="replace")
            raise RuntimeError(f"MCP server closed pipe.\n{err}")
        return line.decode("utf-8").strip()

    def _assert_ready(self) -> None:
        if not self.proc or not self.initialized:
            raise RuntimeError("MCP client not started. Call start() first.")

    async def __aenter__(self):
        await self.start()
        return self

    async def __aexit__(self, *args):
        await self.stop()
