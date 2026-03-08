#!/usr/bin/env python3
"""
Fetch open interest data for one or more tickers via MCP OI server.
Outputs JSON to stdout. Caches results for delta calculation.

Usage:
    python fetch_oi.py --ticker SPY --dte 30
    python fetch_oi.py --ticker SPY,QQQ,AAPL --dte 30,60,90
    python fetch_oi.py --all --dte 30,60,90
"""

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime
from pathlib import Path

from mcp_client import MCPClient

MCP_OI_EXECUTABLE = os.environ.get("MCP_OI_EXECUTABLE", "/mcp-openinterest-server")
CACHE_DIR = Path.home() / ".x-lens" / "oi-cache"

DEFAULT_TICKERS = [
    "SPY", "QQQ", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "TSLA", "NVDA",
    "AMD", "COIN", "HOOD", "ORCL", "HIMS", "OSCR", "UNH", "TTD", "ACHR",
]


def ensure_cache_dir():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)


def cache_path(ticker: str, dte: int, date: str) -> Path:
    return CACHE_DIR / f"{ticker}_{dte}dte_{date}.json"


def save_to_cache(ticker: str, dte: int, data: dict):
    ensure_cache_dir()
    today = datetime.now().strftime("%Y-%m-%d")
    path = cache_path(ticker, dte, today)
    path.write_text(json.dumps(data, indent=2))


async def fetch_ticker(client: MCPClient, ticker: str, dte: int) -> dict:
    """Fetch OI data for a single ticker/DTE combination."""
    try:
        result = await client.call_tool("analyze_open_interest", {
            "ticker": ticker,
            "days": dte,
            "target_dte": dte,
            "include_news": True,
        })
        save_to_cache(ticker, dte, result)
        return {"ticker": ticker, "dte": dte, "status": "ok", "data": result}
    except Exception as e:
        return {"ticker": ticker, "dte": dte, "status": "error", "error": str(e)}


async def fetch_all(tickers: list[str], dtes: list[int]) -> list[dict]:
    """Fetch OI data for all ticker/DTE combinations."""
    results = []
    async with MCPClient(MCP_OI_EXECUTABLE) as client:
        for ticker in tickers:
            for dte in dtes:
                result = await fetch_ticker(client, ticker, dte)
                results.append(result)
                # Brief pause to avoid overwhelming the server
                await asyncio.sleep(0.1)
    return results


def main():
    parser = argparse.ArgumentParser(description="Fetch open interest data via MCP")
    parser.add_argument("--ticker", type=str, help="Comma-separated tickers (e.g., SPY,QQQ)")
    parser.add_argument("--all", action="store_true", help="Fetch all default tickers")
    parser.add_argument("--dte", type=str, default="30,60,90", help="Comma-separated DTEs (default: 30,60,90)")
    parser.add_argument("--compact", action="store_true", help="Output compact summary instead of full data")
    args = parser.parse_args()

    if args.all:
        tickers = DEFAULT_TICKERS
    elif args.ticker:
        tickers = [t.strip().upper() for t in args.ticker.split(",")]
    else:
        parser.error("Provide --ticker or --all")

    dtes = [int(d.strip()) for d in args.dte.split(",")]

    results = asyncio.run(fetch_all(tickers, dtes))

    if args.compact:
        # Output summary only
        compact = []
        for r in results:
            if r["status"] == "ok":
                data = r["data"]
                summary = data.get("summary_metrics") or data.get("data_by_date", {})
                compact.append({
                    "ticker": r["ticker"],
                    "dte": r["dte"],
                    "summary": summary if not isinstance(summary, dict) or len(summary) < 3
                    else {k: v for k, v in list(summary.items())[:1]},
                })
            else:
                compact.append({"ticker": r["ticker"], "dte": r["dte"], "error": r["error"]})
        json.dump(compact, sys.stdout, indent=2)
    else:
        json.dump(results, sys.stdout, indent=2)


if __name__ == "__main__":
    main()
