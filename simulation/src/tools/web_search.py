"""Web search tool for simulation agents using Nova Web Grounding.

Each agent gets a bound closure with their agent_id, enabling
per-agent search limit tracking. Search actions are logged to
a jsonl file for the dashboard to display.
"""

import sys
import os
import json
import logging
from datetime import datetime

log = logging.getLogger("sim.web_search")

ANALYST_PROMPT = (
    "You are a professional equity research analyst. Provide factual, data-driven answers "
    "with specific numbers, dates, and source attribution. Focus on actionable information for "
    "options trading decisions. Always mention price levels, dates, and analyst names when available."
)

# Add the x-lens root so we can import the nova tool
NOVA_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "..", "tools")
sys.path.insert(0, NOVA_PATH)

from nova_web_search import nova_web_search

# Per-agent counters: {agent_id: count}
_agent_search_counts: dict[int, int] = {}
_max_searches_per_agent: int = 5
_log_path: str | None = None
_agent_names: dict[int, str] = {}
_current_round: int = -1
# Track which round each agent last searched in: {agent_id: last_round}
_agent_last_search_round: dict[int, int] = {}


def set_current_round(round_num: int):
    """Called by run_simulation.py at the start of each round."""
    global _current_round
    _current_round = round_num


def configure(max_searches_per_agent: int = 5, log_path: str = None,
              agent_names: dict[int, str] = None):
    """Set the max searches allowed per agent. Call before creating tools."""
    global _max_searches_per_agent, _log_path, _agent_names
    _max_searches_per_agent = max_searches_per_agent
    _log_path = log_path
    _agent_names = agent_names or {}
    _agent_search_counts.clear()
    log.info(f"Web search configured: {max_searches_per_agent}/agent, log={log_path}")


def reset():
    """Reset counters between simulation runs."""
    _agent_search_counts.clear()
    _agent_last_search_round.clear()


def agent_searched_this_round(agent_id: int) -> bool:
    """Check if an agent used search_web in the current round."""
    return _agent_last_search_round.get(agent_id, -1) == _current_round


def _log_search_action(agent_id: int, query: str, result: str):
    """Write search action to actions.jsonl so dashboard can display it."""
    if not _log_path:
        return
    entry = {
        "round": _current_round,
        "timestamp": datetime.now().isoformat(),
        "platform": "twitter",
        "agent_id": agent_id,
        "agent_name": _agent_names.get(agent_id, f"agent_{agent_id}"),
        "action_type": "search_web",
        "action_args": {
            "query": query,
            "result": result,
        }
    }
    try:
        with open(_log_path, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception as e:
        log.error(f"Failed to log search action: {e}")


def _make_search_fn(agent_id: int):
    """Create a search function bound to a specific agent_id."""

    def search_web(query: str) -> str:
        """Search the web for real-time information to fact-check claims or find recent data.

        Use this when you need to verify a claim made by another user, find the latest
        news about a stock, check analyst ratings, or get any live market information.
        Be specific in your query for better results.

        Args:
            query: What to search for. Be specific. Examples:
                   "AAPL latest analyst price targets March 2026"
                   "META lawsuit total liability exposure 2026"
                   "current VIX level and S&P 500 price"
                   "Iran war oil price impact latest news"

        Returns:
            Search results with cited sources from the web.
        """
        count = _agent_search_counts.get(agent_id, 0)
        if count >= _max_searches_per_agent:
            return (f"[SEARCH LIMIT REACHED] You have used all {_max_searches_per_agent} "
                    f"web searches allowed. Rely on existing information and other users' posts.")

        try:
            log.info(f"Agent {agent_id} searching: {query!r} ({count + 1}/{_max_searches_per_agent})")
            result = nova_web_search(query, system_prompt=ANALYST_PROMPT)
            _agent_search_counts[agent_id] = count + 1
            _agent_last_search_round[agent_id] = _current_round
            remaining = _max_searches_per_agent - count - 1

            text = result.get("text", "No results found.")
            citations = result.get("citations", [])

            output = f"[WEB SEARCH RESULT] ({remaining} searches remaining)\n\n{text}"
            if citations:
                output += "\n\nSources:\n"
                for c in citations:
                    output += f"- {c.get('url', c.get('domain', 'unknown'))}\n"

            # Log to actions.jsonl for dashboard
            _log_search_action(agent_id, query, output)

            log.info(f"Agent {agent_id} got {len(text)} chars, {len(citations)} citations")
            return output

        except Exception as e:
            log.error(f"Agent {agent_id} search error: {e}")
            return f"[SEARCH ERROR] Failed to search: {str(e)}"

    return search_web


def make_tool_factory(max_searches_per_agent: int = 5, log_path: str = None,
                      agent_names: dict[int, str] = None):
    """Create a tool factory function that returns per-agent FunctionTool lists.

    Usage in run_simulation.py:
        from src.tools.web_search import make_tool_factory
        factory = make_tool_factory(max_searches_per_agent=3, log_path="actions.jsonl")
        agent_graph = await generate_twitter_agent_graph(..., tool_factory=factory)
    """
    from camel.toolkits import FunctionTool

    configure(max_searches_per_agent, log_path, agent_names)

    def factory(agent_id: int) -> list:
        fn = _make_search_fn(agent_id)
        return [FunctionTool(fn)]

    return factory
