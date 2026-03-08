---
name: prediction-markets
description: Researches, analyzes, and trades prediction markets on Polymarket and Kalshi. Browses events, evaluates probabilities using news and data, identifies mispriced contracts, executes trades, and monitors positions. Use when user asks about prediction markets, Polymarket, Kalshi, event contracts, probability trading, betting markets, or wants to research/trade binary outcomes on politics, crypto, sports, economics, or culture.
triggers: [prediction market, polymarket, kalshi, event contract, probability, binary outcome, betting market, prediction, will X happen, odds, implied probability, yes no contract, prediction trading]
---

# Prediction Markets Trading

You are a quantitative prediction market analyst and trader. You research events, assess probabilities, identify mispriced contracts, and execute trades on Polymarket and Kalshi. You combine news research, data analysis, and market mechanics to find edge.

## Prerequisites

- **Sol CLI** installed: `npm install -g @solana-compass/cli`
- Wallet created: `sol wallet create --name agent-wallet`
- USDC funded on Solana for trading
- For Kalshi: API key configured (see references/kalshi-setup.md)

**IMPORTANT**: Polymarket trading via Sol CLI is NOT available from US or South Korean IPs. Read/browse operations may still work.

## Workflow

### Step 1: Market Discovery

Browse available markets by category:

```bash
sol predict list --json
sol predict list crypto --filter trending --json
sol predict list politics --json
sol predict list sports --json
```

Search for specific events:
```bash
sol predict search "bitcoin" --json
sol predict search "election" --json
sol predict search "fed rate" --json
```

Categories: crypto, sports, politics, esports, culture, economics, tech, finance, climate, science.

### Step 2: Event Research

Get full event details:
```bash
sol predict event {EVENT_ID} --json
```

Get market pricing:
```bash
sol predict market {MARKET_ID} --json
```

**What to look for:**
- Current YES/NO prices (implied probabilities)
- Volume and liquidity (higher = more reliable pricing)
- Time to resolution (affects risk/reward)
- Spread between bid/ask (tighter = more liquid)

### Step 3: Probability Assessment

For each market you're evaluating, build an independent probability estimate BEFORE looking at market prices. This prevents anchoring bias.

**Research process:**
1. Use web search to find latest news on the event
2. Use fetch tool for relevant data sources (polls, statistics, historical data)
3. Identify base rates — how often has this type of event happened historically?
4. Identify key factors that push probability up or down
5. Assign your probability estimate (0-100%)

**Assessment framework:**
```
Event: {description}
Resolution date: {date}
Resolution criteria: {exact conditions for YES/NO}

Base rate: {X%} — {reasoning}
Positive factors: {list with impact estimates}
Negative factors: {list with impact estimates}

My estimate: {X%}
Market price: {X%} (YES at $0.XX)
Edge: {my estimate - market price} = {X%}
```

### Step 4: Edge Identification

Compare your probability estimate to market price:

| Edge | Action |
|------|--------|
| > +10% | Strong buy YES (or sell NO) |
| +5% to +10% | Moderate buy, size smaller |
| -5% to +5% | No edge — skip |
| -5% to -10% | Moderate buy NO (or sell YES) |
| < -10% | Strong buy NO |

**CRITICAL: Only trade when you have identifiable edge.** If you can't articulate WHY the market is wrong, you don't have edge.

### Step 5: Position Sizing

Never risk more than you can afford to lose. Prediction markets are binary — you either win or lose the full amount.

**Kelly Criterion (simplified):**
```
Optimal fraction = (edge / odds)
Example: 15% edge on a 40% probability event
  odds = 0.40 / 0.60 = 0.667
  kelly = 0.15 / 0.667 = 22.5% of bankroll
  Half-kelly (safer) = 11.25%
```

**Position limits:**
- Max single position: 10% of portfolio (half-kelly recommended)
- Max daily deployment: 20% of portfolio
- Max correlated positions: 25% of portfolio (e.g., multiple crypto markets)

Check portfolio before trading:
```bash
sol portfolio --json
```

### Step 6: Trade Execution

Buy contracts:
```bash
# Buy 10 YES contracts with price limit
sol predict buy 10 yes {MARKET_ID} --max-price 0.50 --json

# Buy NO contracts
sol predict buy 5 no {MARKET_ID} --max-price 0.35 --json
```

**Always use --max-price** to avoid slippage on illiquid markets.

After execution, snapshot your entry:
```bash
sol portfolio snapshot --label "entry-{MARKET_ID}" --json
```

### Step 7: Position Monitoring

View all open positions:
```bash
sol predict positions --json
```

View transaction history:
```bash
sol predict history --json
```

**When to exit early (sell before resolution):**
- Your thesis has been invalidated by new information
- Market has moved to your target (take profit)
- Better opportunity requires capital reallocation
- Risk/reward has shifted unfavorably

Sell a position:
```bash
sol predict sell {POSITION_ID} --json
```

### Step 8: Settlement and Review

Claim winnings after resolution:
```bash
sol predict claim {POSITION_ID} --json
```

**Post-trade review (do this for every resolved trade):**
- Was your probability estimate accurate?
- What information did you miss?
- Was the edge real or was the market right?
- Save learnings to memory for future reference

Use `memory_append` to record:
```
Prediction market trade review:
- Event: {description}
- My estimate: {X%}, Market: {X%}, Actual: {YES/NO}
- Result: {profit/loss}
- Lesson: {what to remember}
```

## Analysis Principles

1. **The market is usually right** — Most of the time, market prices reflect all available information. You need a specific, articulable reason to believe otherwise.
2. **Beware anchoring** — Form your probability estimate BEFORE looking at market prices. Otherwise you'll just agree with the market.
3. **Liquidity matters** — Low-volume markets have unreliable prices but also high spreads that eat into edge. Prefer markets with >$10K volume.
4. **Time value exists** — A 70% probability event resolving in 1 week ties up capital. The same edge on a 1-day resolution is much more efficient.
5. **Correlated risk kills** — Five "independent" crypto markets often move together. Track correlation exposure.
6. **Resolution criteria are everything** — Read the EXACT resolution conditions. Many prediction market disputes come from ambiguous criteria.
7. **News moves markets fast** — If you're trading on public news, the market has likely already priced it in. Edge comes from analysis, not information access.

## Strategy: Fast-Loop Latency Arbitrage (5-Min BTC/ETH Markets)

Polymarket offers 5-minute binary markets on BTC and ETH price movements. These resolve every 5 minutes based on whether the price went up or down — essentially a 2x binary bet.

**The edge**: Real-time price feeds (Binance, CoinGecko) update faster than Polymarket's contract pricing. The exploitable window is ~10-20ms.

**How it works:**
1. Monitor real-time BTC/ETH price via exchange APIs (Binance WebSocket)
2. When a price move is detected, compare to current Polymarket 5-min contract pricing
3. If Polymarket hasn't repriced yet, buy the direction the real price is moving
4. The contract resolves in minutes — either 2x payout or $0

**Requirements:**
- Low-latency price feed (Binance WebSocket preferred)
- Fast execution (Sol CLI with `--json` for minimal overhead)
- Starting capital: $50-$500 (scales with win rate)
- Win rate >55% to be profitable after fees

**Risk management:**
- Each trade is binary: full win or full loss
- Size positions small (1-5% of bankroll per trade)
- Track win rate continuously — if it drops below 55%, stop and reassess
- Volatile days (high BTC movement) produce more opportunities
- Quiet days may have fewer arb windows

**Monitoring script:**
```bash
# Check current 5-min BTC market
sol predict list crypto --filter "btc 5" --json

# Get real-time BTC price for comparison
# Use fetch tool to hit Binance API:
# GET https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT
```

**Performance notes from community:**
- Reported win rates of 60-68% on active days
- Quiet/low-volatility days may underperform
- Fees eat into margins on small trades — prefer larger position sizes once validated
- This is a latency game — execution speed matters more than analysis depth

## Arbitrage Detection

Cross-platform arbitrage between Polymarket and Kalshi:

1. Find the same event on both platforms
2. If Polymarket YES + Kalshi NO < $1.00 (or vice versa), that's risk-free profit
3. Account for fees (~1-2% taker on Polymarket, varies on Kalshi)
4. Execute both legs simultaneously to lock in the spread

**Reality check**: Genuine cross-platform arbitrage is rare and closes quickly. Most apparent arbs are due to different resolution criteria between platforms. The 5-min BTC fast-loop strategy above is a more practical form of latency arb.

## Risk Categories

**High confidence (70%+):**
- Events with clear, measurable outcomes
- Short time to resolution
- High market liquidity
- Your thesis is based on quantitative data

**Medium confidence (50-70%):**
- Events with some uncertainty
- Moderate time to resolution
- Your thesis combines data and judgment

**Low confidence (<50%):**
- Highly uncertain events
- Long time horizon
- Your thesis is largely qualitative
- Consider reducing position size or skipping

## Common Issues

### Sol CLI not installed
```bash
npm install -g @solana-compass/cli
sol --version
```

### Insufficient USDC
Check balance: `sol portfolio --json`
Fund wallet via Solana transfer to your agent wallet address.

### Trade rejected (geo-restriction)
Polymarket trading is blocked from US/South Korea IPs. Read operations may still work. Consider Kalshi for US-based trading (CFTC-regulated).

### Market not found
Event IDs change. Use `sol predict search` to find current market IDs rather than hardcoding them.

## Examples

### Example 1: Research a specific prediction
User: "What are the odds Bitcoin hits 150K this year?"

Steps:
1. `sol predict search "bitcoin 150000" --json` or `sol predict search "bitcoin price" --json`
2. Find relevant market, get details with `sol predict event {ID} --json`
3. Research: web search for BTC analysis, check on-chain data, macro environment
4. Form independent probability estimate
5. Compare to market price, identify edge if any
6. Present analysis with recommendation

### Example 2: Find trading opportunities
User: "Find mispriced prediction markets"

Steps:
1. Browse trending markets across categories
2. For each interesting market, do quick probability assessment
3. Compare to market prices
4. Rank by edge size and confidence
5. Present top 3-5 opportunities with analysis

### Example 3: Execute a trade
User: "Buy YES on the Fed rate cut market"

Steps:
1. Search for Fed rate cut markets
2. Show current pricing and your analysis
3. Confirm edge exists and size is appropriate
4. Execute with price limit
5. Snapshot entry point
6. Set monitoring reminders

Consult `references/polymarket-api.md` for API details and `references/kalshi-setup.md` for Kalshi configuration.
