#!/usr/bin/env python3
"""
Enhanced Web Search Tool using Amazon Nova 2 Web Grounding.
- Searches the web with real-time grounding
- Returns synthesized answers with cited sources
- Supports market/finance queries with structured output
"""

import boto3
import json
import sys
import argparse
from botocore.config import Config

def nova_web_search(query: str, model: str = "us.amazon.nova-2-lite-v1:0", 
                     region: str = "us-east-1", system_prompt: str = None,
                     max_tokens: int = 4096) -> dict:
    """
    Search the web using Nova 2 Web Grounding.
    Returns dict with 'text', 'citations', and 'usage'.
    """
    bedrock = boto3.client(
        "bedrock-runtime",
        region_name=region,
        config=Config(read_timeout=3600)
    )
    
    tool_config = {
        "tools": [{
            "systemTool": {
                "name": "nova_grounding"
            }
        }]
    }
    
    messages = [{
        "role": "user",
        "content": [{"text": query}]
    }]
    
    kwargs = dict(
        modelId=model,
        messages=messages,
        toolConfig=tool_config,
        inferenceConfig={"maxTokens": max_tokens}
    )
    
    if system_prompt:
        kwargs["system"] = [{"text": system_prompt}]
    
    response = bedrock.converse(**kwargs)
    
    # Parse response
    text_parts = []
    citations = []
    
    for content in response["output"]["message"]["content"]:
        if "text" in content:
            text_parts.append(content["text"])
        elif "citationsContent" in content:
            for citation in content["citationsContent"]["citations"]:
                loc = citation.get("location", {}).get("web", {})
                citations.append({
                    "url": loc.get("url", ""),
                    "domain": loc.get("domain", "")
                })
    
    return {
        "text": "".join(text_parts),
        "citations": citations,
        "usage": response.get("usage", {}),
        "stop_reason": response.get("stopReason", "")
    }


def market_search(ticker: str, query_type: str = "news") -> dict:
    """
    Specialized market search for stocks.
    query_type: 'news', 'analyst', 'technicals', 'options', 'full'
    """
    queries = {
        "news": f"What are the latest news and developments for {ticker} stock in the past 7 days? Include price movements, analyst commentary, and any significant events.",
        "analyst": f"What are the latest analyst ratings, price targets, and upgrades/downgrades for {ticker} stock? Include analyst firm names and specific targets.",
        "technicals": f"What is the current technical analysis for {ticker} stock? Include support/resistance levels, moving averages, RSI, and trend direction.",
        "options": f"What is the current options activity for {ticker} stock? Include put/call ratios, unusual options activity, implied volatility, and any large block trades.",
        "full": f"""Provide a comprehensive analysis of {ticker} stock covering:
1. Current price and recent price action (last 5 days)
2. Latest news (last 7 days) 
3. Analyst ratings and price targets
4. Key risks and catalysts
5. Options activity if notable
6. Sector/industry trends affecting this stock
Be specific with numbers, dates, and source names.""",
        "earnings": f"When does {ticker} report earnings next? What are the consensus estimates for revenue and EPS? What did they report last quarter?",
        "put_credit_spread": f"""For {ticker} stock, analyze the safety of selling put credit spreads:
1. Current stock price and recent support levels
2. Analyst consensus and lowest price target
3. Key downside risks that could crash the stock
4. Any upcoming catalysts (earnings, FDA, etc.) that could cause large moves
5. Recent institutional buying/selling activity
Be specific and quantitative."""
    }
    
    query = queries.get(query_type, queries["news"])
    
    system = """You are a professional equity research analyst. Provide factual, data-driven answers 
with specific numbers, dates, and source attribution. Focus on actionable information for 
options trading decisions. Always mention price levels, dates, and analyst names when available."""
    
    return nova_web_search(query, system_prompt=system)


def multi_ticker_scan(tickers: list, query_type: str = "full") -> dict:
    """Scan multiple tickers."""
    results = {}
    for ticker in tickers:
        try:
            results[ticker] = market_search(ticker, query_type)
            print(f"✅ {ticker}: {len(results[ticker]['text'])} chars, {len(results[ticker]['citations'])} citations", file=sys.stderr)
        except Exception as e:
            results[ticker] = {"error": str(e)}
            print(f"❌ {ticker}: {e}", file=sys.stderr)
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Nova Web Grounding Search")
    parser.add_argument("query", nargs="?", help="Search query (or use --ticker)")
    parser.add_argument("--ticker", "-t", help="Stock ticker for market search")
    parser.add_argument("--type", "-T", default="full", 
                        choices=["news", "analyst", "technicals", "options", "full", "earnings", "put_credit_spread"],
                        help="Query type for market search")
    parser.add_argument("--tickers", nargs="+", help="Multiple tickers to scan")
    parser.add_argument("--model", default="us.amazon.nova-2-lite-v1:0")
    parser.add_argument("--json", action="store_true", help="Output raw JSON")
    parser.add_argument("--system", help="Custom system prompt")
    
    args = parser.parse_args()
    
    if args.tickers:
        results = multi_ticker_scan(args.tickers, args.type)
        if args.json:
            print(json.dumps(results, indent=2))
        else:
            for ticker, data in results.items():
                print(f"\n{'='*60}")
                print(f"  {ticker}")
                print(f"{'='*60}")
                if "error" in data:
                    print(f"ERROR: {data['error']}")
                else:
                    print(data["text"])
                    if data["citations"]:
                        print(f"\n📎 Sources: {', '.join(c['domain'] for c in data['citations'][:5])}")
    elif args.ticker:
        result = market_search(args.ticker, args.type)
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print(result["text"])
            if result["citations"]:
                print(f"\n📎 Sources ({len(result['citations'])}):")
                for c in result["citations"]:
                    print(f"  - {c['url']}")
    elif args.query:
        result = nova_web_search(args.query, model=args.model, system_prompt=args.system)
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print(result["text"])
            if result["citations"]:
                print(f"\n📎 Sources ({len(result['citations'])}):")
                for c in result["citations"]:
                    print(f"  - {c['url']}")
    else:
        parser.print_help()
