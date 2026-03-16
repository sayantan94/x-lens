---
name: market-sentiment-simulator
description: Run social sentiment simulations to model how market news, events, or narratives propagate across social networks (Twitter/Reddit), predict sentiment shifts, and identify trading opportunities from crowd behavior
triggers: [simulate, simulation, sentiment simulation, swarm, crowd behavior, opinion spread, narrative, social sentiment, what if, counterfactual, how will market react, sentiment propagation, crowd reaction]
---

## Instructions

You are using the x-lens social simulation engine — a multi-agent system that simulates how information spreads across Twitter and Reddit through autonomous agents with distinct personalities and behavioral biases. This is your crystal ball for predicting crowd sentiment shifts before they happen.

**Simulation package:** `simulation/` (Python, uses OASIS framework)
**Virtual env:** `simulation/.venv`

### When to Use This Skill

- "What happens if [company] announces [event]?" — counterfactual analysis
- "How will the market react to [news]?" — sentiment propagation prediction
- "Is this narrative going to spread?" — information cascade modeling
- "What's the crowd sentiment around [topic]?" — social dynamics analysis
- Pre-earnings scenario planning, Fed decision impact modeling, sector rotation narratives

### Step 1: Create Simulation Directory

```bash
SIM_ID="sim_$(date +%s)"
SIM_DIR="$HOME/.x-lens/simulations/$SIM_ID"
mkdir -p "$SIM_DIR"
```

### Step 2: Generate Agent Profiles

Generate diverse market participants from the scenario:

```bash
cd simulation && source .venv/bin/activate && python -m src.generate_profiles \
  --scenario "<scenario description>" \
  --count 20 \
  --output "$SIM_DIR/profiles.json"
```

The LLM generates a diverse cast — bulls, bears, neutrals, influencers, retail traders, institutional PMs, analysts, and degens — each with unique backstories and biases.

### Step 3: Generate Simulation Config

```bash
cd simulation && source .venv/bin/activate && python -m src.generate_config \
  --profiles "$SIM_DIR/profiles.json" \
  --scenario "<scenario description>" \
  --sim-id "$SIM_ID" \
  --output "$SIM_DIR/simulation_config.json"
```

### Step 4: Run the Simulation

```bash
cd simulation && source .venv/bin/activate && python -m src.run_simulation \
  --config "$SIM_DIR/simulation_config.json" \
  --profiles "$SIM_DIR/profiles.json" \
  --platform parallel \
  --max-rounds 72 &
```

Monitor completion by checking for the marker:

```bash
# Poll until simulation completes
while ! grep -q "simulation_complete" "$SIM_DIR/actions.jsonl" 2>/dev/null; do
  sleep 10
done
echo "Simulation complete"
```

### Step 5: Generate Report

```bash
cd simulation && source .venv/bin/activate && python -m src.generate_report \
  --sim-dir "$SIM_DIR" \
  --scenario "<scenario description>"
```

Read the report:

```bash
cat "$SIM_DIR/report.md"
```

### Step 6: Interview Agents (Optional — Counterfactual Analysis)

Interview specific agents while the simulation process is still running:

```bash
# Interview a specific agent
cd simulation && source .venv/bin/activate && python -m src.interview \
  --sim-dir "$SIM_DIR" \
  --agent-id 5 \
  --prompt "Would you buy, hold, or sell right now? Why?"

# Interview ALL agents
cd simulation && source .venv/bin/activate && python -m src.interview \
  --sim-dir "$SIM_DIR" \
  --all \
  --prompt "What would change your mind about this trade?"
```

### Step 7: Extract Trading Signal

After reading the report and interview responses, synthesize into an actionable signal:

1. **Sentiment Direction**: Is the crowd turning bullish, bearish, or split?
2. **Propagation Speed**: How fast is the narrative spreading? Fast = already priced in. Slow = potential alpha.
3. **Consensus vs Divergence**: Strong consensus = crowded trade risk. Divergence = uncertainty.
4. **Influential Agents**: Which simulated participants drove the narrative?
5. **Counter-narratives**: Did any agents push back? What were their arguments?
6. **Timeline**: When does sentiment peak/trough in the simulation?

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

### Counterfactual (if interviews run)
- "What if [X]?" — [agent response summary]
```

### Important Notes

- Simulations are compute-intensive — a single run can take 5-30 minutes depending on agent count and rounds
- Seed content quality directly impacts simulation quality — more context = better agent behavior
- For market events, always include the contrarian view in the scenario description to avoid one-sided simulations
- The simulation requires an LLM API (configured via `simulation/.env`) — ensure `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL_NAME` are set
- Use `--max-rounds` to limit simulation length for faster results during testing
