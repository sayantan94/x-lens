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

```bash
/Users/sayantan/Documents/Workspace/personal-assist/x-lens/simulation/simulate.sh \
  --scenario "<detailed scenario description including bullish AND bearish arguments>" \
  --count 10 \
  --max-rounds 30 \
  --platform twitter \
  --port 5055
```

**CRITICAL RULES:**
- Use ONLY `simulate.sh` — do NOT run `python3 -m src.*` commands yourself
- Do NOT activate the venv yourself — the script handles it
- Do NOT create simulation directories yourself — the script handles it
- The script returns IMMEDIATELY — the pipeline runs in the background
- Tell the user to watch the dashboard for live progress
- Do NOT fabricate results. If something fails, check the log file.

**What it does (automatically, in the background):**
1. Creates a sim directory in `~/.x-lens/simulations/`
2. Generates diverse agent profiles (bulls, bears, neutrals, influencers, analysts, degens)
3. Generates simulation config with seed posts and timing
4. Starts the live dashboard at `http://localhost:<port>`
5. Runs the multi-agent simulation
6. Generates the analysis report
7. Saves report to `$SIM_DIR/report.md`

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
| `--max-rounds` | 30 | Simulation rounds (1 round ≈ 30-60 min simulated time) |
| `--platform` | twitter | `twitter`, `reddit`, or `parallel` (both) |
| `--port` | 5055 | Dashboard port |
| `--sim-id` | auto | Custom simulation ID |

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
cd /Users/sayantan/Documents/Workspace/personal-assist/x-lens/simulation && source .venv/bin/activate && python3 -m src.interview \
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
- Use `--platform twitter` for faster runs, `--platform parallel` for both Twitter+Reddit
