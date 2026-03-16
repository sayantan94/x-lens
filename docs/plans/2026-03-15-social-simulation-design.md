# Social Sentiment Simulation — Design

Supersedes: `2026-03-13-trader-simulation-design.md` (multi-perspective LLM calls only).
This design adds actual social platform simulation via OASIS where agents interact on Twitter/Reddit.

## Problem

The trader persona analyzes markets from a single perspective. Even the adversarial simulation skill (previous design) uses independent LLM calls that don't interact. Real market sentiment propagates through social networks — narratives spread, echo chambers form, counter-narratives emerge. We need to simulate this propagation to predict crowd behavior.

## Solution

Integrate OASIS social simulation into x-lens as a Python subprocess package. The trader persona seeds a scenario, generates a cast of market participants, runs a dual-platform simulation (Twitter + Reddit), then analyzes the results for trading signals.

No knowledge graph. No Neo4j. No Flask. Profiles are generated directly by LLM from a scenario prompt.

## Architecture

```
x-lens/
├── simulation/                          # New Python package
│   ├── pyproject.toml
│   ├── .env.example
│   ├── src/
│   │   ├── generate_profiles.py         # scenario → profiles.json
│   │   ├── generate_config.py           # profiles + scenario → simulation_config.json
│   │   ├── run_simulation.py            # OASIS runner, writes actions.jsonl, IPC for interviews
│   │   ├── interview.py                 # IPC client to query running sim agents
│   │   ├── generate_report.py           # actions.jsonl + scenario → report.md (ReACT)
│   │   ├── models.py                    # Pydantic models
│   │   └── ipc.py                       # Unix socket IPC server/client
│   └── README.md
├── skills/trader/
│   └── market-sentiment-simulator/
│       └── skill.md                     # Orchestration instructions for trader persona
```

All simulation data: `~/.x-lens/simulations/<sim_id>/`

## Component Details

### 1. `generate_profiles.py`

**Input**: `--scenario "NVDA beats earnings by 20%, guides up" --count 20 --output profiles.json`

**Logic**: Single LLM call with `response_format=json`. Prompt asks for N agents with:

| Field | Type | Description |
|-------|------|-------------|
| user_id | int | Sequential ID |
| username | str | Social media handle |
| name | str | Display name |
| bio | str | 200-char social bio |
| persona | str | 2000-char detailed backstory, trading style, stance, trigger points |
| age | int | Age |
| gender | str | male/female/other |
| mbti | str | MBTI type |
| profession | str | Role (day trader, PM, analyst, etc.) |
| interested_topics | list[str] | What they follow |
| sentiment_bias | float | -1.0 (extreme bear) to 1.0 (extreme bull) |
| influence_weight | float | 0.5 (nobody) to 5.0 (major influencer) |
| activity_level | float | 0.1 (lurker) to 1.0 (power poster) |
| archetype | str | e.g. retail_bull, institutional_short, fintwit_influencer |

The LLM generates a diverse cast — ensuring bulls, bears, neutrals, high/low influence, and different archetypes are represented.

**Output**: `profiles.json`

### 2. `generate_config.py`

**Input**: `--profiles profiles.json --scenario "..." --output simulation_config.json`

**Logic**: Single LLM call. Generates:

- **time_config**: total_simulation_hours, minutes_per_round, peak/off-peak activity multipliers
- **event_config**: hot_topics, narrative_direction, initial_posts (mapped to agent IDs by archetype)
- **platform_config**: recommendation algorithm weights (recency/popularity/relevance)
- **agent_configs**: per-agent activity schedules, posting frequency, response delay

**Output**: `simulation_config.json`

### 3. `run_simulation.py`

**Input**: `--config simulation_config.json --profiles profiles.json --platform parallel --max-rounds 72`

**Logic**:
1. Loads OASIS framework (`camel-oasis`)
2. Creates agent graph from profiles
3. Seeds initial posts from event_config
4. Main loop per round:
   - Select active agents based on time-of-day multipliers
   - Each agent calls LLM via OASIS `agent.act()` to decide action
   - Actions: CREATE_POST, LIKE_POST, REPOST, QUOTE_POST, CREATE_COMMENT, FOLLOW, SEARCH, DO_NOTHING
   - Each action logged as JSON line to `actions.jsonl`
5. After final round: writes `{"event": "simulation_complete"}` to actions.jsonl
6. Starts IPC server on Unix socket (`~/.x-lens/simulations/<sim_id>/ipc.sock`)
7. Auto-exits after 10 minutes of IPC inactivity

**Output**: `actions.jsonl`, stays alive for interviews

### 4. `interview.py`

**Input**: `--sim-dir <path> --agent-id 5 --prompt "Would you buy right now?"`
  or: `--sim-dir <path> --all --prompt "..."`

**Logic**: Connects to running simulation via IPC socket. Sends interview command. Agent responds in-character using its persona + accumulated memory from the simulation.

**Output**: JSON to stdout `{agent_id, agent_name, archetype, response}`

### 5. `generate_report.py`

**Input**: `--sim-dir <path> --scenario "..."`

**Logic**:
1. Reads `actions.jsonl`
2. Aggregates metrics:
   - Sentiment distribution over time (bullish/bearish/neutral %)
   - Most active agents + their influence
   - Narrative themes (from post content)
   - Propagation speed (how fast posts get liked/reposted)
   - Engagement metrics (total posts, likes, reposts, comments)
3. LLM call with ReACT pattern (2-3 reflection rounds):
   - Think: what patterns emerge from the data?
   - Analyze: quantify sentiment shift, identify key voices
   - Write: draft section
   - Reflect: does this match the data? revise if needed
4. Structures final report with trading signal

**Output**: `report.md`

## Skill Workflow

The `market-sentiment-simulator` skill instructs the trader persona to:

```
Step 1: mkdir -p ~/.x-lens/simulations/sim_$(date +%s)

Step 2: python simulation/src/generate_profiles.py \
          --scenario "<scenario>" --count 20 \
          --output <sim_dir>/profiles.json

Step 3: python simulation/src/generate_config.py \
          --profiles <sim_dir>/profiles.json \
          --scenario "<scenario>" \
          --output <sim_dir>/simulation_config.json

Step 4: python simulation/src/run_simulation.py \
          --config <sim_dir>/simulation_config.json \
          --profiles <sim_dir>/profiles.json \
          --platform parallel &
        (poll actions.jsonl for "simulation_complete" marker)

Step 5: python simulation/src/generate_report.py \
          --sim-dir <sim_dir> --scenario "<scenario>"

Step 6: (Optional) python simulation/src/interview.py \
          --sim-dir <sim_dir> --all \
          --prompt "Would you buy, hold, or sell right now?"

Step 7: Agent reads report.md + interview responses,
        synthesizes trading signal, [ALERT] if high-conviction
```

## Output Format

```markdown
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

## LLM Provider

Python scripts read from the x-lens `.env` file:
- `LLM_BASE_URL` (or `OPENAI_BASE_URL`)
- `LLM_API_KEY` (or `OPENAI_API_KEY`)
- `LLM_MODEL_NAME` (or `OPENAI_MODEL`)

Uses `openai` Python SDK in OpenAI-compatible mode. Works with any provider that exposes an OpenAI-compatible API (Ollama, OpenRouter, vLLM, etc.).

OASIS internally uses the same OpenAI-compatible client for agent LLM calls.

## Dependencies

```
camel-ai[oasis]     # OASIS simulation framework
openai              # LLM client (OpenAI-compatible)
pydantic            # Data models
python-dotenv       # .env loading
```

Python 3.10+. No Neo4j. No Flask. No embeddings.
