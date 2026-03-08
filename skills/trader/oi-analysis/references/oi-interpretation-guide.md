# OI Interpretation Guide

## Reading Put/Call Ratios

| P/C Ratio | Interpretation |
|-----------|---------------|
| < 0.5     | Extreme bullish sentiment (contrarian bearish) |
| 0.5 - 0.7 | Bullish sentiment |
| 0.7 - 1.0 | Neutral to slightly bearish |
| 1.0 - 1.5 | Bearish sentiment |
| > 1.5     | Extreme bearish (contrarian bullish) |

**Important**: Always compare to the ticker's own historical P/C ratio. Some tickers naturally run higher or lower.

## Strike-Level Patterns

### Call Walls (Heavy call OI at a strike)
- Acts as **resistance** — market makers are short calls, will sell stock to hedge as price approaches
- If call wall is ABOVE current price: defines upside target/cap
- If call wall is breached: triggers gamma squeeze as MMs must buy more

### Put Walls (Heavy put OI at a strike)
- Acts as **support** — market makers are short puts, will buy stock to hedge as price drops
- If put wall is BELOW current price: defines downside support
- If put wall is broken: triggers cascade as MMs must sell more

### Max Pain
- The strike where option holders collectively lose the most money
- Price tends to gravitate here by expiration (pinning effect)
- More reliable for near-term (30 DTE) than longer-dated options

## Institutional Patterns

### Accumulation Signs
- Large OI increases (>5K contracts) at specific strikes
- Concentrated in 60-90 DTE (strategic timeframe)
- P/C ratio gradually shifting in one direction over multiple days
- New strikes appearing with immediate large OI

### Distribution Signs
- OI decreasing at previously heavy strikes
- Rolling from one expiry to a nearer one (closing long-term, opening short-term)
- Increasing put OI while call OI stays flat

### Hedging vs Directional
- **Hedging**: Large put OI increase alongside existing equity positions (shows in 30-60 DTE)
- **Directional**: Call OR put concentrated at out-of-money strikes with high conviction (shows in 60-90 DTE)
- **Spread structures**: Both call and put OI increase at nearby strikes = spread/collar = neutral-to-hedged

## DTE-Specific Framing

| DTE | Primary Use | Key Signal |
|-----|------------|------------|
| 30  | Gamma/momentum | Mechanical price pressure from MM hedging |
| 50  | Swing trades | Medium-term direction from active traders |
| 60  | Institutional | Accumulation/distribution patterns |
| 90  | Strategic | Core portfolio positioning and major hedges |

## VIX OI Context

| VIX P/C | Market Mood | Implication for Stock OI |
|---------|-------------|-------------------------|
| < 0.6   | Fearful (hedging) | Bullish stock OI may be less reliable |
| 0.6-1.5 | Neutral | Stock OI signals at face value |
| > 1.5   | Complacent | Bearish stock OI may be less reliable |
