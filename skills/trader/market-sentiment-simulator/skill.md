---
name: market-sentiment-simulator
description: Run social sentiment simulations to model how market news, events, or narratives propagate across social networks (Twitter/Reddit), predict sentiment shifts, and identify trading opportunities from crowd behavior
triggers: [simulate, simulation, sentiment simulation, swarm, crowd behavior, opinion spread, narrative, social sentiment, what if, counterfactual, how will market react, sentiment propagation, crowd reaction]
---

## Instructions

You are using the x-lens social simulation engine — a multi-agent system that simulates how information spreads across Twitter and Reddit through autonomous agents with distinct personalities and behavioral biases. This is your crystal ball for predicting crowd sentiment shifts before they happen.

### When to Use This Skill

- "What happens if [company] announces [event]?" — counterfactual analysis
- "How will the market react to [news]?" — sentiment propagation prediction
- "Is this narrative going to spread?" — information cascade modeling
- "What's the crowd sentiment around [topic]?" — social dynamics analysis
- Pre-earnings scenario planning, Fed decision impact modeling, sector rotation narratives

### Running a Simulation

**Use the all-in-one script.** It handles venv activation, all pipeline steps, and the dashboard. Run it with a SINGLE shell command:

**BEFORE launching, create TWO data files from the data you already gathered:**

**File 1: Raw market data context** — dump ALL OI data, news, and market regime data into a markdown file. This gets injected into every agent's context so they can cite specific numbers:

```bash
cat > ~/.x-lens/simulations/context_$$.md << 'EOF'
## OI Data by DTE

### 3 DTE
| Strike | Call OI | Put OI | P/C | Net |
|--------|--------|--------|-----|-----|
| $595   | 2,100  | 45,000 | 21.4| PUT |
| $600   | 15,000 | 250,000| 16.7| PUT |
| $605   | 28,000 | 12,000 | 0.43| CALL|
[... include ALL strikes with significant OI ...]
- Max Pain: $600
- Total OI: 2.4M contracts
- P/C Ratio: 1.46

### 31 DTE
[... same format ...]

### 90 DTE
[... same format ...]

## News & Catalysts
- [date] headline (source) — bull/bear/neutral
- [date] headline (source) — bull/bear/neutral
[... include ALL news you found ...]

## Market Regime
- VIX: 22.37 (falling from 35)
- Breadth: 33/100
- SPY trend: [above/below 50/200 DMA]
- Sector rotation: [leaders/laggards]
- Correlation: [risk-on/risk-off signals]

## Price Action
- Current: $603.15
- 52W High/Low: $XXX / $XXX
- Key support: $XXX, $XXX
- Key resistance: $XXX, $XXX
- Volume: XX vs avg XX
EOF
```

Context file rules:
- Include EVERY strike with >5K OI, not just the top walls
- Separate OI data by DTE so agents can argue about specific expiries
- Include ALL news headlines you found, not just the top 5
- Include raw numbers — agents will cite them in their posts

**File 2: Seed posts** — debate starters that reference the context data:

```bash
cat > ~/.x-lens/simulations/seed_posts_$$.json << 'EOF'
[
  {"poster_agent_id": 0, "content": "$TICKER breaking news tweet with specific data..."},
  {"poster_agent_id": 1, "content": "OI analysis tweet citing exact call/put walls, P/C ratio, max pain..."},
  {"poster_agent_id": 2, "content": "Bear case tweet with specific price levels and risk factors..."},
  {"poster_agent_id": 3, "content": "Macro context tweet linking VIX, sector rotation, FOMC..."},
  {"poster_agent_id": 4, "content": "Options flow tweet citing unusual activity, gamma levels..."}
]
EOF
```

Seed post rules:
- Use REAL data you already collected (OI numbers, price levels, news headlines)
- Each post should be under 280 chars, like a real tweet
- Cover multiple angles: bull case, bear case, OI analysis, macro, catalyst
- poster_agent_id 0-4 maps to the first 5 agents (they'll be assigned during profile generation)
- Make them provocative enough to spark debate

Then launch:

```bash
/Users/sayantbh/Workspace/fintool/x-lens/simulation/simulate.sh \
  --scenario "<detailed scenario description including bullish AND bearish arguments>" \
  --count 10 \
  --max-rounds 40 \
  --platform parallel \
  --port 5055 \
  --web-search \
  --fact-check \
  --seed-posts ~/.x-lens/simulations/seed_posts_$$.json \
  --context-file ~/.x-lens/simulations/context_$$.md
```

**CRITICAL RULES:**
- Use ONLY `simulate.sh` — do NOT run `python3 -m src.*` commands yourself
- Do NOT activate the venv yourself — the script handles it
- Do NOT create simulation directories yourself — the script handles it
- The script returns IMMEDIATELY — the pipeline runs in the background
- Tell the user to watch the dashboard for live progress
- Do NOT fabricate results. If something fails, check the log file.
- **NEVER kill simulation processes.** Simulations take 15-60 minutes. Do NOT run `kill`, `pkill`, or any command that would terminate simulation/dashboard/worker processes. Let them run to completion.
- After launching, move on to other tasks. Check `$SIM_DIR/report.md` later or poll `/api/status` for completion.
- Do NOT wait/block for the simulation to finish. It runs in the background — you can do other work.

**What it does (automatically, in the background):**
1. Creates a sim directory in `~/.x-lens/simulations/`
2. Generates diverse agent profiles (bulls, bears, neutrals, influencers, analysts, degens)
3. Generates simulation config with seed posts and timing
4. Starts the live dashboard at `http://localhost:<port>`
5. Runs the multi-agent simulation
6. Generates the analysis report
7. Saves report to `$SIM_DIR/report.md`
8. If `--fact-check` enabled: verifies factual claims in agent posts against live web data

**After launching**, tell the user:
- Dashboard: `http://localhost:<port>` (shows live pipeline progress)
- Log: `tail -f $SIM_DIR/pipeline.log`
- Report will appear at `$SIM_DIR/report.md` when done
- Pipeline takes 5-30 minutes depending on agent count

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--scenario` | (required) | The market scenario to simulate |
| `--count` | 10 | Number of agents |
| `--seed-posts` | (none) | Path to JSON file with agent-created seed posts (overrides LLM-generated seeds) |
| `--context-file` | (none) | Path to markdown file with raw OI/news/regime data (injected into every agent's context) |
| `--max-rounds` | 40 | Max simulation rounds (signal peaks at 30-40, no value beyond) |
| `--platform` | twitter | `twitter`, `reddit`, or `parallel` (both) |
| `--port` | 5055 | Dashboard port |
| `--sim-id` | auto | Custom simulation ID |
| `--fact-check` | off | Enable automatic fact-checking of agent posts via Nova web grounding |
| `--fact-check-rate` | 1.0 | Fraction of posts to fact-check (0.0-1.0, saves API cost) |

### After the Simulation

The script prints the report. Read it and synthesize into an actionable trading signal:

1. **Sentiment Direction**: Is the crowd turning bullish, bearish, or split?
2. **Propagation Speed**: How fast is the narrative spreading? Fast = already priced in. Slow = potential alpha.
3. **Consensus vs Divergence**: Strong consensus = crowded trade risk. Divergence = uncertainty.
4. **Influential Agents**: Which simulated participants drove the narrative?
5. **Counter-narratives**: Did any agents push back? What were their arguments?
6. **Timeline**: When does sentiment peak/trough in the simulation?

### Interview Agents (Optional — Counterfactual Analysis)

Interview agents WHILE the simulation is still running (the script keeps the process alive for 600s after simulation ends):

```bash
cd /Users/sayantbh/Workspace/fintool/x-lens/simulation && source .venv/bin/activate && python3 -m src.interview \
  --sim-dir "$HOME/.x-lens/simulations/<SIM_ID>" \
  --all \
  --prompt "What would change your mind about this trade?"
```

### Output Format

```
## Simulation Signal: [Topic]

**Scenario**: [What was simulated]
**Agents**: [N] participants across Twitter + Reddit
**Rounds**: [N] rounds ([N] simulated hours)

### Sentiment Trajectory
- Start: [X% bullish / Y% bearish / Z% neutral]
- End: [X% bullish / Y% bearish / Z% neutral]
- Shift: [direction + magnitude]

### Propagation Analysis
- Dominant narrative: [what spread fastest]
- Counter-narrative: [opposing view + strength]
- Consensus level: [high/medium/low] — [crowded trade risk implication]
- Speed: [fast = priced in, slow = potential alpha]

### Key Voices
- [Agent name (archetype)] — [what they said] — [engagement]

### Trading Implication
- Direction: [BULLISH / BEARISH / MIXED] — [confidence %]
- If bullish: [entry, target, stop]
- If bearish: [hedge, exit, short level]
- Timing: [when does sentiment peak/trough in simulation]
- Risk: [what could invalidate]
```

### Important Notes

- **ALWAYS use `simulate.sh`** — it handles venv, directories, and all steps
- Simulations take 5-30 minutes — do not interrupt
- For market events, always include the contrarian view in the scenario description to avoid one-sided simulations
- The simulation requires an LLM API (configured via `simulation/.env`)
- Dashboard goes live at step 3 — tell the user to open it while simulation runs
- Use `--platform parallel` for both Twitter+Reddit (default), `--platform twitter` for faster runs
