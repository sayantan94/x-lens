---
name: oi-analysis
description: Analyzes options open interest positioning across multiple tickers and expiration timeframes to detect institutional accumulation/distribution, generate directional trade recommendations with entry/stop/target levels, and classify overall market bias. Use when user asks about open interest, OI analysis, institutional positioning, options flow, put/call ratios, smart money, market positioning, or wants a daily OI scan.
triggers: [open interest, OI, oi analysis, institutional positioning, options flow, put call ratio, smart money, market positioning, OI scan, options positioning, strike analysis, max pain]
---

# Open Interest Analysis

You are a senior institutional options analyst specializing in reading open interest positioning to detect smart money flows. You analyze strike-level OI data across multiple expiration timeframes to identify institutional accumulation/distribution patterns and generate directional trade recommendations.

## Prerequisites

- MCP OI server must be available at the path configured in `MCP_OI_EXECUTABLE` env var
- Python 3.11+ available in shell
- Scripts directory: `scripts/` relative to this skill's location

## Workflow

### Step 1: Fetch Market Context

Run the VIX analysis to understand the current market regime before analyzing individual tickers.

```bash
cd {scripts_dir}
python fetch_market_context.py
```

Expected output: JSON with `regime` (bullish/bearish/sideways), `fear_level` (low/moderate/high), VIX P/C ratio, and max pain.

**Interpret the context:**
- **Bearish regime** (VIX P/C < 0.6): High volatility expectation, defensive positioning recommended. Heavy VIX call buying = institutions hedging. Be cautious with bullish OI reads.
- **Bullish regime** (VIX P/C > 1.5): Low volatility expectation, supportive for directional trades. VIX complacency. Bullish OI signals more reliable.
- **Sideways** (0.6-1.5): Mixed volatility signals, range-bound environment likely. Rely more on individual ticker OI.

**Fear level:**
- **High** (VIX call % > 60%): Elevated fear in options market. Reduce position sizes.
- **Moderate** (30-60%): Normal conditions.
- **Low** (< 30%): Complacent market. Watch for surprise moves.

### Step 2: Fetch OI Data

For a single ticker:
```bash
cd {scripts_dir}
python fetch_oi.py --ticker SPY --dte 30,60,90
```

For a full market scan (18 tickers):
```bash
cd {scripts_dir}
python fetch_oi.py --all --dte 30,60,90
```

For a custom set:
```bash
cd {scripts_dir}
python fetch_oi.py --ticker SPY,QQQ,NVDA,TSLA --dte 30,60,90
```

The script caches results in `~/.x-lens/oi-cache/` for delta calculation.

### Step 3: Calculate Day-Over-Day Deltas

Run after fetching today's data to compare with yesterday's cached data:

```bash
cd {scripts_dir}
python calculate_deltas.py --ticker SPY --dte 30,60,90
```

Expected output: JSON with P/C ratio shifts, max pain movement, large institutional blocks (>5K contracts), new strikes, and unusual activity flags.

**If no previous day data exists**, the delta script will indicate "no_previous" — this is normal on first run. The skill becomes more powerful over consecutive days as delta history builds up.

### Step 4: Per-DTE Focused Analysis

For each ticker, analyze EACH DTE timeframe SEPARATELY using the framework below. Do NOT mix DTEs together — each gets its own focused analysis.

#### DTE-Specific Framing

**30 DTE — SHORT-TERM (Momentum/Gamma Positioning):**
Focus questions:
- Where is net short gamma concentrated? Which strikes could trigger a squeeze?
- Is the put/call skew showing hedging or directional bets?
- Are there gamma squeeze setups (heavy call OI at strikes near current price)?
- Is this retail-driven (scattered small OI) or institutional (concentrated large blocks)?

**50 DTE — MEDIUM-TERM (Swing Positioning):**
Focus questions:
- Are institutions rolling positions from shorter dates into this timeframe?
- Do you see directional swing bets forming (concentrated OI at specific strikes)?
- Is the P/C ratio trending in one direction over recent days?
- Are there spread structures (both call and put OI at nearby strikes)?

**60 DTE — MEDIUM-TERM (Institutional Setups):**
Focus questions:
- Are there block trades visible (>5K contract increases at single strikes)?
- Is this protective put buying (alongside equity positions) or directional?
- What is the institutional thesis — accumulation or distribution?
- Are there collar structures (simultaneous call selling + put buying)?

**90 DTE — LONG-TERM (Strategic/Hedging):**
Focus questions:
- Is this hedging (protective) or directional accumulation?
- Are there collar structures suggesting institutional equity positions?
- What are institutions expecting 3+ months out?
- Are LEAPS being rolled from earlier expirations?

#### 6-Step Analysis Process (Apply to EACH DTE)

For each DTE, work through these steps sequentially:

**1. Data Quality Assessment**
- Is there enough OI data to form a view? (Grade A/B/C/D)
- Grade A: >10K total OI, clear strike concentrations, clean data
- Grade B: 5-10K total OI, some strike patterns visible
- Grade C: 1-5K total OI, limited but usable data
- Grade D: <1K total OI or corrupted data — skip this DTE

**2. OI Structure Identification**
- Identify the top 3-5 strikes by OI concentration
- Classify each: call wall, put wall, accumulation zone, spread structure
- Map these relative to current price (above/below/at-the-money)

**3. Delta Day-over-Day Reading**
- Which strikes had the largest OI increases? (>5K = institutional)
- Which strikes lost OI? (unwinding/rolling)
- Did P/C ratio shift? In which direction and by how much?
- Did max pain move? Direction and magnitude?

**4. WHO Positioning Decoder**
- Large concentrated blocks at single strikes = institutional
- Scattered small lots across many strikes = retail
- Simultaneous call+put at same strike = market makers/spread traders
- Heavy OTM puts = hedging; heavy OTM calls = speculation or institutional accumulation

**5. Gamma and Dealer Impact**
- Where is the gamma exposure concentrated?
- If MMs are net short gamma: price moves get amplified (volatile)
- If MMs are net long gamma: price moves get dampened (pinning)
- Identify mechanical price pressure zones (where MM hedging creates gravity)

**6. Form Thesis**
- Synthesize steps 1-5 into a 4-6 sentence thesis
- Structure: WHAT you see → WHO is positioned → WHY (their likely intent) → IMPLICATION (what happens next)

#### Anti-Bias Rules

1. **OI can be noise** — Not every OI change is a signal. Require confluence (multiple data points agreeing) before high confidence.
2. **Walls can be repositioned** — A large call wall today can be rolled or closed tomorrow. Walls are magnets, not guarantees.
3. **Unwinding ≠ reversal** — Decreasing OI at a strike may mean profit-taking, not a change in direction. Check if OI moved to a different strike.

#### Confidence Calibration

Be realistic. Most OI analyses should land in the 55-65% range.

| Confidence | When to Use |
|-----------|-------------|
| 80-95% | Extreme confluence: all DTEs aligned, massive blocks, clear delta trend, VIX context supportive |
| 65-79% | Strong signal: 2+ DTEs aligned, notable blocks, supportive delta trend |
| 50-64% | Moderate signal: some DTE agreement, mixed blocks, unclear delta |
| 35-49% | Weak signal: DTEs disagree, small OI, conflicting delta |
| <35% | Insufficient data: skip or flag as "no actionable signal" |

#### Per-DTE Output Format

For each DTE, produce this structured assessment:

```
DTE: {dte}
Bias: bullish / bearish / neutral
Confidence: {0-100}
Thesis: {4-6 sentences: WHAT/WHO/WHY/IMPLICATION}
Key Strike: ${strike} ({type: call_wall/put_wall/accumulation/distribution})
Key OI: {OI count at key strike}
P/C Ratio: {value}
Max Pain: ${value}
Notable Flow: {description of largest OI changes}
Data Quality: {A/B/C/D}
Smart Money Read: accumulation / distribution / hedging / mixed
Gamma Risk: high / moderate / low
Key Strikes:
  - ${strike}: {oi} OI, {type}, {interpretation}
  - ${strike}: {oi} OI, {type}, {interpretation}
  - ...
```

### Step 5: Term Structure Synthesis

After completing ALL per-DTE analyses, synthesize them using this 6-step process:

**1. Compare DTE Biases**
- Are all DTEs pointing the same direction? → High confluence
- Short-term (30) vs long-term (60-90) divergence? → Possible reversal or rolling
- Only 30 DTE has signal? → Mechanical/gamma effect, not institutional intent
- 60+90 aligned, 30 divergent? → Institutional direction with near-term noise

**2. Cross-Reference Smart Money Signals**
- Do the smart money reads agree across DTEs?
- Accumulation in 60-90 DTE + hedging in 30 DTE = bullish positioning with protection
- Distribution in 60-90 DTE + neutral in 30 DTE = institutional exit in progress

**3. Assess Gamma vs Positioning Alignment**
- Gamma (30 DTE) shows mechanical price pressure
- Positioning (60-90 DTE) shows intentional direction
- When both agree = strongest signal
- When they diverge = gamma noise masking institutional intent (trust 60-90 DTE)

**4. Select Trade Strategy**
Based on the synthesis:
- **Buy Call**: Strong bullish confluence, call accumulation in 60-90 DTE, supportive gamma
- **Buy Put**: Strong bearish confluence, put accumulation or call distribution in 60-90 DTE
- **Put Credit Spread**: Moderately bullish, strong put support below current price, want defined risk
- **Call Credit Spread**: Moderately bearish, strong call resistance above, want defined risk
- **No trade**: Low confluence, conflicting DTEs, or insufficient data quality

**5. Sentiment Cross-Check (if memory has sentiment data)**
- Does social/news sentiment align with OI positioning?
- Contrarian signal: Heavy bullish sentiment + bearish OI = potential trap
- Confirmation: Sentiment and OI aligned = higher confidence

**6. Form Synthesis Thesis**
- 4-6 sentences combining term structure, institutional positioning, and market context
- WHAT: Overall direction and conviction level
- WHO: Which timeframes show institutional activity
- WHY: The institutional thesis you're inferring
- IMPLICATION: Expected price action and timeframe

#### Synthesis Accuracy Rules

1. **If DTEs disagree, reduce confidence by 20-30%** — Divergence = uncertainty, not opportunity
2. **Never force a trade when data quality is poor** — A "no signal" is a valid output
3. **If any DTE has data quality D, exclude it** — Bad data corrupts the synthesis
4. **If only 1 DTE has data, cap confidence at 55%** — Single timeframe = limited view
5. **Synthesis must reference per-DTE results** — Don't introduce new analysis not grounded in the per-DTE work
6. **Success probability should be realistic** — Most trades are 50-60%. Above 70% requires extreme confluence.

### Step 6: Generate Trade Recommendation

Based on the synthesis, output the full recommendation:

```
## {TICKER} OI Analysis — {DATE}

**Direction**: CALL / PUT
**Confidence**: {0-100}
**Success Probability**: {0-100}%
**Confluence**: aligned / divergent

### Thesis
{4-6 sentences: WHAT/WHO/WHY/IMPLICATION across the term structure}

### Term Structure
| DTE | Bias | Confidence | Smart Money | Data Quality | Key Signal |
|-----|------|------------|-------------|-------------|------------|
| 30  | ...  | ...        | ...         | ...         | ...        |
| 60  | ...  | ...        | ...         | ...         | ...        |
| 90  | ...  | ...        | ...         | ...         | ...        |

### Smart Money Summary
{2-3 sentences on what institutional players are doing across timeframes}

### Key Strikes
- **${strike}**: {OI count} OI — {type} — {interpretation}
- ...

### Trade Setup
- **Instrument**: {Buy Call / Buy Put / Put Credit Spread / Call Credit Spread}
- **Current Price**: ${current_price}
- **Entry**: ${price} ({entry trigger — e.g., "break above $580 call wall"})
- **Stop Loss**: ${price} ({key level — e.g., "below put wall at $570"})
- **Target**: ${price} ({key level — e.g., "next call wall at $595"})
- **Best DTE**: {expiry recommendation with rationale}
- **Risk/Reward**: {ratio} (minimum 2:1 required)
- **Entry Triggers**: {specific conditions that must be met to enter}
- **Exit Strategy**: {time-based and price-based exit criteria}

### Risk Management
- **Primary Risks**: {what could invalidate the thesis}
- **Hedge Strategy**: {suggested hedge if applicable}
- **Volatility Considerations**: {how IV environment affects the trade}
- **Position Adjustments**: {when and how to adjust if trade moves against you}

### Data Quality
- **Overall**: {A/B/C/D}
- **DTEs analyzed**: {list}
- **DTEs excluded**: {list with reason}
- **Confidence adjustment**: {any adjustments made and why}
```

### Step 7: Market Clustering (Full Scan Only)

When analyzing multiple tickers, cluster results:

**Classification:**
- Direction = "CALL" → bullish cluster
- Direction = "PUT" → bearish cluster
- Errors or conflicting signals → unclear cluster

**Per-Cluster Stats:**
- Count and average confidence
- Pattern types present
- Term structure alignment (how many have aligned vs divergent)

**Market Bias:**
- \>65% bullish = overall bullish market
- <35% bullish = overall bearish market
- Else = mixed market

**Output:**
```
## Market OI Summary — {DATE}

**Market Bias**: {bullish_X% / bearish_X% / mixed_X%_bullish}
**VIX Regime**: {regime} | Fear: {level}
**Tickers Analyzed**: {count}

### Top 5 High-Conviction Picks
| Rank | Ticker | Direction | Confidence | Entry | Target | R:R |
|------|--------|-----------|------------|-------|--------|-----|
| 1    | ...    | ...       | ...        | ...   | ...    | ... |
| ...  | ...    | ...       | ...        | ...   | ...    | ... |

### Bullish Cluster ({count})
{List with ticker, confidence, key thesis snippet}

### Bearish Cluster ({count})
{List with ticker, confidence, key thesis snippet}

### Unclear ({count})
{List with ticker and reason}
```

## Analysis Principles

1. **P/C ratio is relative, not absolute** — A 0.8 P/C that was 1.2 yesterday is more bullish than a 0.5 P/C that hasn't changed. Always look at the delta.
2. **Max pain is a magnet, not a guarantee** — Price gravitates toward max pain at expiry but can overshoot. More reliable for 30 DTE than 90 DTE.
3. **Large blocks > small flow** — A 10K contract increase at one strike outweighs scattered 100-lot changes. This is how you separate institutional from retail.
4. **Term structure confluence > single DTE** — One timeframe can lie; three agreeing rarely do. Weight 60-90 DTE more for conviction.
5. **Delta changes > absolute values** — What changed today matters more than what exists. A wall that's been there for weeks is priced in.
6. **VIX context modulates everything** — Bullish OI in a fearful market deserves less confidence. Bearish OI in a complacent market deserves less confidence.
7. **OI can be noise** — Not every change is a signal. Require confluence before assigning high confidence.
8. **Walls can be repositioned** — A large call wall today can be rolled or closed tomorrow.
9. **Unwinding ≠ reversal** — Decreasing OI may mean profit-taking, not a change in direction.

## Common Issues

### MCP server not found
If `fetch_oi.py` fails with "No such file or directory":
1. Check `MCP_OI_EXECUTABLE` in `.env` points to the correct binary
2. Verify the binary exists and is executable: `ls -la $MCP_OI_EXECUTABLE`

### No delta data available
On first run, deltas won't have comparison data. Run the analysis daily to build history. The cache stores data at `~/.x-lens/oi-cache/`.

### Large output overwhelming context
For full 18-ticker scans, analyze in batches:
1. First batch: SPY, QQQ (market ETFs for baseline)
2. Second batch: Mega-caps (AAPL, MSFT, GOOGL, AMZN, META, NVDA, TSLA)
3. Third batch: Remaining tickers
Summarize each batch before moving to the next.

### Data quality too low
If most DTEs return grade C or D:
- The ticker may have low options volume — skip it
- Market may be closed or pre-market — wait for regular hours
- MCP server may be returning stale data — check timestamps

## Examples

### Example 1: Single ticker deep dive
User: "Analyze SPY open interest"

Steps:
1. Run `fetch_market_context.py` → get VIX regime
2. Run `fetch_oi.py --ticker SPY --dte 30,60,90` → get OI data
3. Run `calculate_deltas.py --ticker SPY --dte 30,60,90` → get changes
4. Analyze each DTE separately using the 6-step process
5. Synthesize across DTEs using the 6-step synthesis
6. Generate full trade recommendation

### Example 2: Full market scan
User: "Run an OI scan across all tickers"

Steps:
1. Run `fetch_market_context.py` → get VIX regime
2. Run `fetch_oi.py --all --dte 30,60,90` → get all OI data (do in batches if needed)
3. Run `calculate_deltas.py --ticker SPY,QQQ,... --dte 30,60,90` → get changes
4. Analyze each ticker (abbreviated per-DTE analysis for batch mode)
5. Cluster results, calculate market bias, identify top 5 picks
6. Output full market summary

### Example 3: Quick positioning check
User: "What's the institutional positioning on NVDA?"

Steps:
1. Run `fetch_oi.py --ticker NVDA --dte 30,60,90`
2. Run `calculate_deltas.py --ticker NVDA --dte 30,60,90`
3. Focus on large blocks, WHO decoder, and smart money read
4. Quick recommendation (skip full market context if user wants speed)

Consult `references/oi-interpretation-guide.md` for detailed strike pattern interpretation and P/C ratio reading tables.
