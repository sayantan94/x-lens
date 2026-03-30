#!/usr/bin/env python3
"""Build rich market context for simulation agents.

Automatically fetches live data from multiple sources:
1. Market regime (SPY, VIX, breadth)
2. Sector rotation & relative strength
3. Ticker-specific OI data via MCP server (proper pipeline)
4. Macro events (FOMC, CPI, earnings)
5. News headlines

Agents get structured facts, not opinions. They form their own views.
"""

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import requests

# Add MCP client path
SCRIPTS_DIR = Path(__file__).parent.parent / "skills" / "trader" / "oi-analysis" / "scripts"
if not SCRIPTS_DIR.exists():
    SCRIPTS_DIR = Path(os.path.expanduser("~/Workspace/fintool/x-lens/skills/trader/oi-analysis/scripts"))
sys.path.insert(0, str(SCRIPTS_DIR))

MCP_OI_EXECUTABLE = os.environ.get(
    "MCP_OI_EXECUTABLE",
    "/Users/sayantbh/Workspace/fintool/mcp_env/open_interest/bin/mcp-openinterest-server"
)


def fetch_yahoo_price(ticker: str) -> dict:
    """Fetch live price data from Yahoo Finance."""
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?range=5d&interval=1d"
        r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
        d = r.json()["chart"]["result"][0]
        meta = d["meta"]
        closes = d["indicators"]["adjclose"][0]["adjclose"]
        volumes = d["indicators"]["quote"][0]["volume"]
        return {
            "price": meta["regularMarketPrice"],
            "day_high": meta.get("regularMarketDayHigh"),
            "day_low": meta.get("regularMarketDayLow"),
            "52w_high": meta["fiftyTwoWeekHigh"],
            "52w_low": meta["fiftyTwoWeekLow"],
            "volume": meta.get("regularMarketVolume"),
            "prev_close": meta.get("chartPreviousClose", meta.get("previousClose")),
            "closes_5d": [c for c in closes if c],
            "volumes_5d": [v for v in volumes if v],
        }
    except Exception as e:
        return {"error": str(e)}


async def fetch_oi_via_mcp(ticker: str, days: int = 5) -> dict:
    """Fetch OI data through the MCP OI server (proper pipeline with analyzer)."""
    try:
        from mcp_client import MCPClient
        async with MCPClient(MCP_OI_EXECUTABLE) as client:
            result = await client.call_tool("analyze_open_interest", {
                "ticker": ticker,
                "days": days,
                "include_news": True,
            })
            return result
    except Exception as e:
        return {"error": str(e)}


def format_mcp_oi(oi_data: dict) -> str:
    """Format MCP OI response into readable context for agents."""
    if "error" in oi_data:
        return f"- OI data unavailable: {oi_data['error']}"
    
    lines = []
    ticker = oi_data.get("ticker", "?")
    dates = oi_data.get("dates_analyzed", [])
    
    for date_str, day_data in oi_data.get("data_by_date", {}).items():
        metrics = day_data.get("summary_metrics", {})
        exp = day_data.get("expiration_date", "?")
        
        total_oi = metrics.get("total_open_interest", 0)
        call_oi = metrics.get("call_open_interest", 0)
        put_oi = metrics.get("put_open_interest", 0)
        pc = metrics.get("put_call_ratio", 0)
        max_pain = metrics.get("max_pain", 0)
        call_wavg = metrics.get("call_weighted_avg", 0)
        put_wavg = metrics.get("put_weighted_avg", 0)
        skew = metrics.get("put_call_skew", 0)
        
        bull_bear = "CALL-DOMINATED (bullish)" if pc < 0.5 else \
                    "PUT-DOMINATED (bearish)" if pc > 1.5 else "MIXED"
        
        lines.append(f"\n### Expiry: {exp} (data date: {date_str})")
        lines.append(f"- **Total OI**: {total_oi:,} | Calls: {call_oi:,} | Puts: {put_oi:,}")
        lines.append(f"- **P/C Ratio**: {pc} — {bull_bear}")
        lines.append(f"- **Max Pain**: ${max_pain}")
        lines.append(f"- **Call Weighted Avg**: ${call_wavg} | Put Weighted Avg: ${put_wavg}")
        lines.append(f"- **Put/Call Skew**: {skew:+.2f}")
        
        # Top call strikes
        top_calls = day_data.get("top_call_strikes", [])[:7]
        if top_calls:
            lines.append("- **Top Call Strikes (by OI)**:")
            for s in top_calls:
                lines.append(f"  - ${s['strike']}: {s['openInterest']:,} OI")
        
        # Top put strikes
        top_puts = day_data.get("top_put_strikes", [])[:7]
        if top_puts:
            lines.append("- **Top Put Strikes (by OI)**:")
            for s in top_puts:
                lines.append(f"  - ${s['strike']}: {s['openInterest']:,} OI")
    
    # News context if available
    news = oi_data.get("news_context", "")
    if news:
        lines.append(f"\n### News Context")
        lines.append(news[:2000])
    
    return "\n".join(lines)


def build_context(ticker: str, sector: str = "", oi_days: int = 5,
                  extra_context: str = "") -> str:
    """Build full structured context document."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M ET")
    
    sections = []
    sections.append(f"# MARKET DATA SNAPSHOT — {now}")
    sections.append("These are FACTS. Do not invent prices or events not listed here.\n")

    # 1. Broad market
    sections.append("## 1. BROAD MARKET")
    for sym, label in [("SPY", "S&P 500 ETF"), ("QQQ", "Nasdaq 100 ETF"),
                       ("IWM", "Russell 2000 ETF"), ("^VIX", "VIX")]:
        data = fetch_yahoo_price(sym)
        if "error" not in data:
            chg = ""
            if data.get("prev_close") and data["prev_close"] > 0:
                pct = (data["price"] - data["prev_close"]) / data["prev_close"] * 100
                chg = f" ({pct:+.2f}%)"
            sections.append(f"- **{label} ({sym})**: ${data['price']:.2f}{chg}")
            sections.append(f"  52W: ${data['52w_low']:.2f} - ${data['52w_high']:.2f}")
            if data.get("closes_5d"):
                closes = ", ".join(f"${c:.2f}" for c in data["closes_5d"])
                sections.append(f"  Last 5 closes: {closes}")

    # 2. Sector context
    if sector:
        sections.append(f"\n## 2. SECTOR: {sector.upper()}")
        sector_etfs = {
            "defense": [("ITA", "iShares US Aerospace & Defense"), ("PPA", "Invesco Aerospace & Defense")],
            "energy": [("XLE", "Energy Select SPDR"), ("XOP", "Oil & Gas E&P")],
            "utility": [("XLU", "Utilities Select SPDR")],
            "technology": [("XLK", "Technology Select SPDR"), ("SMH", "Semiconductor ETF")],
            "healthcare": [("XLV", "Health Care Select SPDR")],
            "financial": [("XLF", "Financial Select SPDR")],
            "industrial": [("XLI", "Industrial Select SPDR")],
        }
        for sym, label in sector_etfs.get(sector.lower(), []):
            data = fetch_yahoo_price(sym)
            if "error" not in data:
                chg = ""
                if data.get("prev_close") and data["prev_close"] > 0:
                    pct = (data["price"] - data["prev_close"]) / data["prev_close"] * 100
                    chg = f" ({pct:+.2f}%)"
                sections.append(f"- **{label} ({sym})**: ${data['price']:.2f}{chg}")
                if data.get("closes_5d"):
                    closes = ", ".join(f"${c:.2f}" for c in data["closes_5d"])
                    sections.append(f"  Last 5 closes: {closes}")

    # 3. Target ticker data
    sections.append(f"\n## 3. TARGET STOCK: {ticker}")
    stock_data = fetch_yahoo_price(ticker)
    if "error" not in stock_data:
        chg = ""
        if stock_data.get("prev_close") and stock_data["prev_close"] > 0:
            pct = (stock_data["price"] - stock_data["prev_close"]) / stock_data["prev_close"] * 100
            chg = f" ({pct:+.2f}%)"
        dist_high = (stock_data["price"] - stock_data["52w_high"]) / stock_data["52w_high"] * 100
        sections.append(f"- **Price**: ${stock_data['price']:.2f}{chg}")
        sections.append(f"- **Day Range**: ${stock_data.get('day_low', 'N/A')} - ${stock_data.get('day_high', 'N/A')}")
        sections.append(f"- **52W Range**: ${stock_data['52w_low']:.2f} - ${stock_data['52w_high']:.2f} ({dist_high:+.1f}% from high)")
        if stock_data.get("volume"):
            sections.append(f"- **Volume**: {stock_data['volume']:,}")
        if stock_data.get("closes_5d"):
            closes_str = ", ".join(f"${c:.2f}" for c in stock_data["closes_5d"])
            sections.append(f"- **Last 5 closes**: {closes_str}")

    # 4. OI Data via MCP (rich analysis with max pain, skew, clusters, news)
    sections.append(f"\n## 4. OPTIONS OPEN INTEREST ({ticker}) — via MCP Analyzer")
    print(f"Fetching OI via MCP server ({oi_days} days)...", file=sys.stderr)
    oi_result = asyncio.run(fetch_oi_via_mcp(ticker, days=oi_days))
    sections.append(format_mcp_oi(oi_result))

    # 5. Macro context
    sections.append("\n## 5. MACRO CONTEXT")
    for sym, label in [("CL=F", "WTI Crude Oil"), ("GC=F", "Gold"), 
                       ("BTC-USD", "Bitcoin"), ("^TNX", "10Y Treasury Yield")]:
        data = fetch_yahoo_price(sym)
        if "error" not in data:
            chg = ""
            if data.get("prev_close") and data["prev_close"] > 0:
                pct = (data["price"] - data["prev_close"]) / data["prev_close"] * 100
                chg = f" ({pct:+.2f}%)"
            sections.append(f"- **{label}**: ${data['price']:.2f}{chg}")

    # 6. Extra context (hand-written scenario, news, catalysts)
    if extra_context:
        sections.append(f"\n## 6. SCENARIO & CATALYSTS")
        sections.append(extra_context)

    # Footer
    sections.append("\n---")
    sections.append("IMPORTANT: The above data is factual. Do NOT fabricate prices, ")
    sections.append("breaking news, or events not listed here. If speculating about ")
    sections.append("what COULD happen, clearly label it as hypothetical.")

    return "\n".join(sections)


def main():
    parser = argparse.ArgumentParser(description="Build market context for simulation")
    parser.add_argument("--ticker", required=True, help="Target stock ticker")
    parser.add_argument("--sector", default="", help="Sector name (defense, energy, etc)")
    parser.add_argument("--oi-days", type=int, default=5, help="OI lookback days (default: 5)")
    parser.add_argument("--extra", default="", help="Path to extra context file")
    parser.add_argument("--output", required=True, help="Output context.md path")
    args = parser.parse_args()

    extra = ""
    if args.extra and os.path.exists(args.extra):
        extra = Path(args.extra).read_text()

    context = build_context(args.ticker, args.sector, args.oi_days, extra)
    
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(context)
    print(f"Context built: {len(context)} chars → {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
