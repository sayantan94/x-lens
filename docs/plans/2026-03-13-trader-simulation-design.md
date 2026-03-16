# Trader Simulation System Design

## Problem

All 37 trader skills do single-perspective analysis. The agent gathers data, scores it, and alerts. There is zero adversarial testing — no skill ever argues against its own thesis. This is the #1 accuracy killer (confirmation bias).

## Solution

A simulation system that stress-tests trading theses through multi-perspective LLM analysis before alerting. Inspired by MiroFish's swarm intelligence approach — distinct agent personas with independent stances that analyze the same data separately, then synthesize.

## Architecture

**Approach B: Script-based orchestrator** — A Python script makes separate LLM API calls for each simulated perspective. Each perspective gets its own system prompt in a separate API call = zero bias leakage between perspectives.

### Components

1. **Simulation Skill** (`skills/trader/simulation/SKILL.md`) — Agent instructions for when/how to run simulations
2. **Simulation Engine** (`skills/trader/simulation/scripts/simulate.py`) — Python script that orchestrates multi-perspective LLM calls
3. **Daemon Prompt Update** (`app/src/daemon.ts`) — Trader persona awareness of simulation + "run all scenarios" trigger

### Provider Support

Uses `litellm` Python package to support all x-lens providers:

| x-lens provider | litellm model prefix | Env var |
|---|---|---|
| `anthropic` | `anthropic/claude-sonnet-4-20250514` | `ANTHROPIC_API_KEY` |
| `amazon-bedrock` | `bedrock/anthropic.claude-sonnet-4-20250514-v1:0` | AWS credentials |
| `openrouter` | `openrouter/qwen/qwen3-235b-a22b` | `OPENROUTER_API_KEY` |
| `groq` | `groq/qwen/qwen3-32b` | `GROQ_API_KEY` |

Script accepts `--provider` and `--model` flags matching daemon config.

## Simulation Modes

### 1. `adversarial` — Kill Confirmation Bias

4 independent LLM calls:
- **Bull**: Conviction growth investor. Finds strongest evidence supporting the thesis.
- **Bear**: Professional short seller. Finds every reason the trade fails.
- **Skeptic**: Risk manager. Attacks assumptions, questions data freshness, identifies timing risks.
- **Judge**: Weighs all perspectives. Assigns calibrated probability. Cites strongest evidence.

### 2. `scenarios` — Probability-Weighted Outcome Tree

Generates 3-5 scenarios (base, bull, bear, tail-risk) with:
- Probability weight
- Price target range
- Key catalyst/trigger
- Tracking criteria (how to know this scenario is playing out)
- Invalidation level

### 3. `participants` — Market Participant Reaction Modeling

5 independent LLM calls simulating how each participant class reacts to an event:
- **Retail**: FOMO/panic, narrative-driven, 0-2 day timeframe
- **Institutional**: Rebalance, risk-manage, 1-5 day timeframe
- **Market Maker**: Delta/gamma hedge, intraday
- **Options Dealer**: Pin risk, unwind, expiry week
- **Quant/Systematic**: Momentum/mean-reversion triggers, signal-dependent

### 4. `premortem` — Backwards Failure Analysis

Works from "this trade lost 2R" backwards to identify specific kill conditions. Forces the agent to generate concrete failure scenarios rather than vague "what could go wrong" speculation.

### 5. `paintrade` — Crowding & Forced Unwind Detection

Analyzes OI + positioning data to model:
- Current positioning map (net long/short by participant type)
- Crowded side identification
- Forced unwind cascade simulation (trigger level → stops → gamma → capitulation)
- The specific price level and direction of maximum pain

### 6. `all` — Run All Scenarios

Runs all 5 modes concurrently, then a final synthesis call that:
- Cross-references findings across all perspectives
- Identifies convergence (all modes agree) vs divergence (modes disagree)
- Produces a unified conviction score with evidence trail
- Generates a structured simulation report

## Data Flow

```
Agent gathers market data (existing skills: OI, breadth, earnings, etc.)
    |
Agent calls: shell("python simulate.py --mode all --provider bedrock --model ...")
    |
Script reads context from stdin (JSON: thesis, ticker, data, event details)
    |
Script spawns N independent LLM calls (asyncio, separate system prompts)
    |
Script outputs structured JSON to stdout
    |
Agent reads results -> adjusts conviction -> decides alert/no-alert
```

## Daemon Prompt Changes

### Add to trader `mission`:
- "Stress-test all high-conviction findings through multi-perspective simulation before alerting"

### Add to trader `howToThink`:
- "5. Before any >65% conviction alert, run simulation skill in adversarial mode to stress-test your thesis"
- "6. When user says 'run all scenarios' or 'simulate [ticker/event]', load simulation skill and run mode=all"

## File Structure

```
skills/trader/simulation/
├── SKILL.md                    # Agent instructions
└── scripts/
    ├── simulate.py             # Multi-perspective simulation engine
    └── requirements.txt        # litellm
```

## Perspective Prompt Design (MiroFish-inspired)

Each perspective agent receives:
1. **System prompt**: Their role, stance, behavioral profile (like MiroFish's agent personas)
2. **User message**: The same market data/thesis context (shared input)
3. **Response format**: Structured JSON with evidence citations

This mirrors MiroFish's pattern of giving each agent a distinct stance + activity pattern, then collecting their independent outputs for synthesis.
