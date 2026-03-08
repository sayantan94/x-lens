#!/usr/bin/env python3
"""
Fetch VIX open interest data and derive market regime/fear classification.
Outputs JSON market context to stdout.

Usage:
    python fetch_market_context.py
    python fetch_market_context.py --dte 30
"""

import argparse
import asyncio
import json
import os
import sys

from mcp_client import MCPClient

MCP_OI_EXECUTABLE = os.environ.get("MCP_OI_EXECUTABLE", "/mcp-openinterest-server")


def classify_regime(pc_ratio: float) -> str:
    """Classify market regime from VIX put/call ratio."""
    if pc_ratio < 0.6:
        return "bearish"  # Low P/C = lots of calls = hedging/fear
    elif pc_ratio > 1.5:
        return "bullish"  # High P/C = lots of puts = complacency
    else:
        return "sideways"


def classify_fear(call_pct: float) -> str:
    """Classify fear level from VIX call percentage."""
    if call_pct > 0.65:
        return "high"  # Heavy call buying = fear of volatility spike
    elif call_pct > 0.50:
        return "moderate"
    else:
        return "low"


async def fetch_vix_context(dte: int = 30) -> dict:
    """Fetch VIX OI and derive market context."""
    async with MCPClient(MCP_OI_EXECUTABLE) as client:
        result = await client.call_tool("analyze_open_interest", {
            "ticker": "VIX",
            "days": dte,
            "target_dte": dte,
            "include_news": False,
        })

    # Extract metrics
    metrics = result.get("summary_metrics", {})
    if not metrics:
        # Try nested structure
        data_by_date = result.get("data_by_date", {})
        if data_by_date:
            latest = list(data_by_date.values())[-1]
            metrics = latest.get("summary_metrics", {})

    total_oi = metrics.get("total_open_interest", 0)
    call_oi = metrics.get("call_open_interest", 0)
    put_oi = metrics.get("put_open_interest", 0)
    pc_ratio = metrics.get("put_call_ratio", 1.0)
    max_pain = metrics.get("max_pain", 0)

    call_pct = call_oi / total_oi if total_oi > 0 else 0.5

    regime = classify_regime(pc_ratio)
    fear = classify_fear(call_pct)

    context = {
        "vix_oi": {
            "total_open_interest": total_oi,
            "call_open_interest": call_oi,
            "put_open_interest": put_oi,
            "put_call_ratio": round(pc_ratio, 3),
            "max_pain": max_pain,
        },
        "regime": regime,
        "fear_level": fear,
        "call_percentage": round(call_pct, 3),
        "summary": f"Market regime: {regime}. Fear level: {fear}. VIX P/C ratio: {pc_ratio:.2f}, max pain: {max_pain}.",
    }

    return context


def main():
    parser = argparse.ArgumentParser(description="Fetch VIX market context via MCP")
    parser.add_argument("--dte", type=int, default=30, help="DTE for VIX analysis (default: 30)")
    args = parser.parse_args()

    result = asyncio.run(fetch_vix_context(args.dte))
    json.dump(result, sys.stdout, indent=2)


if __name__ == "__main__":
    main()
