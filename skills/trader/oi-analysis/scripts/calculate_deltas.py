#!/usr/bin/env python3
"""
Calculate day-over-day OI changes by comparing today's cached data with yesterday's.
Detects large blocks, unusual activity, and sentiment shifts.

Usage:
    python calculate_deltas.py --ticker SPY --dte 30
    python calculate_deltas.py --ticker SPY,QQQ --dte 30,60
"""

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

CACHE_DIR = Path.home() / ".x-lens" / "oi-cache"

LARGE_BLOCK_THRESHOLD = 5000  # >5K OI increase = institutional
UNUSUAL_OI_CHANGE_PCT = 0.20  # >20% change = unusual
UNUSUAL_PC_SHIFT = 0.15       # >0.15 P/C ratio change = unusual


def get_cached_data(ticker: str, dte: int, date: str) -> dict | None:
    path = CACHE_DIR / f"{ticker}_{dte}dte_{date}.json"
    if path.exists():
        return json.loads(path.read_text())
    return None


def extract_metrics(data: dict) -> dict:
    """Extract summary metrics from OI data (handles nested structures)."""
    metrics = data.get("summary_metrics")
    if metrics:
        return metrics
    data_by_date = data.get("data_by_date", {})
    if data_by_date:
        latest = list(data_by_date.values())[-1]
        return latest.get("summary_metrics", {})
    return {}


def extract_strikes(data: dict) -> dict:
    """Extract strike-level OI data."""
    strikes = data.get("strikes")
    if strikes:
        return strikes
    data_by_date = data.get("data_by_date", {})
    if data_by_date:
        latest = list(data_by_date.values())[-1]
        return latest.get("strikes", {})
    return {}


def calculate_delta(ticker: str, dte: int, today: str, yesterday: str) -> dict:
    """Calculate delta between today and yesterday's data."""
    today_data = get_cached_data(ticker, dte, today)
    yesterday_data = get_cached_data(ticker, dte, yesterday)

    if not today_data:
        return {"ticker": ticker, "dte": dte, "status": "error", "error": "No data for today"}

    today_metrics = extract_metrics(today_data)

    if not yesterday_data:
        return {
            "ticker": ticker, "dte": dte, "status": "no_previous",
            "today": today_metrics,
            "message": "No previous day data for comparison",
        }

    yesterday_metrics = extract_metrics(yesterday_data)

    # Metric deltas
    pc_today = today_metrics.get("put_call_ratio", 0)
    pc_yesterday = yesterday_metrics.get("put_call_ratio", 0)
    pc_delta = round(pc_today - pc_yesterday, 4)

    mp_today = today_metrics.get("max_pain", 0)
    mp_yesterday = yesterday_metrics.get("max_pain", 0)
    mp_delta = mp_today - mp_yesterday

    oi_today = today_metrics.get("total_open_interest", 0)
    oi_yesterday = yesterday_metrics.get("total_open_interest", 0)
    oi_change_pct = (oi_today - oi_yesterday) / oi_yesterday if oi_yesterday > 0 else 0

    # Strike-level analysis
    today_strikes = extract_strikes(today_data)
    yesterday_strikes = extract_strikes(yesterday_data)
    large_blocks = []
    new_strikes = []

    for side in ["calls", "puts"]:
        today_side = today_strikes.get(side, {})
        yesterday_side = yesterday_strikes.get(side, {})

        for strike, oi in today_side.items():
            prev_oi = yesterday_side.get(strike, 0)
            change = oi - prev_oi
            if change >= LARGE_BLOCK_THRESHOLD:
                large_blocks.append({
                    "strike": strike, "side": side,
                    "change": change, "current_oi": oi,
                })
            if strike not in yesterday_side and oi > 1000:
                new_strikes.append({"strike": strike, "side": side, "oi": oi})

    # Unusual activity flags
    unusual = []
    if abs(oi_change_pct) > UNUSUAL_OI_CHANGE_PCT:
        unusual.append(f"Total OI changed {oi_change_pct:+.1%}")
    if abs(pc_delta) > UNUSUAL_PC_SHIFT:
        direction = "more bearish" if pc_delta > 0 else "more bullish"
        unusual.append(f"P/C ratio shifted {pc_delta:+.3f} ({direction})")
    if abs(mp_delta) > 0:
        unusual.append(f"Max pain moved {'up' if mp_delta > 0 else 'down'} ${abs(mp_delta):.0f}")

    return {
        "ticker": ticker,
        "dte": dte,
        "status": "ok",
        "metrics": {
            "pc_ratio": {"today": pc_today, "yesterday": pc_yesterday, "delta": pc_delta},
            "max_pain": {"today": mp_today, "yesterday": mp_yesterday, "delta": mp_delta},
            "total_oi": {"today": oi_today, "yesterday": oi_yesterday, "change_pct": round(oi_change_pct, 4)},
        },
        "large_blocks": large_blocks,
        "new_strikes": new_strikes,
        "unusual_activity": unusual,
    }


def main():
    parser = argparse.ArgumentParser(description="Calculate OI deltas from cached data")
    parser.add_argument("--ticker", type=str, required=True, help="Comma-separated tickers")
    parser.add_argument("--dte", type=str, default="30,60,90", help="Comma-separated DTEs")
    args = parser.parse_args()

    tickers = [t.strip().upper() for t in args.ticker.split(",")]
    dtes = [int(d.strip()) for d in args.dte.split(",")]

    today = datetime.now().strftime("%Y-%m-%d")
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

    results = []
    for ticker in tickers:
        for dte in dtes:
            results.append(calculate_delta(ticker, dte, today, yesterday))

    json.dump(results, sys.stdout, indent=2)


if __name__ == "__main__":
    main()
