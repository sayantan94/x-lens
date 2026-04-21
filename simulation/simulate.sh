#!/usr/bin/env bash
# All-in-one simulation launcher. Returns immediately — runs pipeline in background.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Defaults
COUNT=10
MAX_ROUNDS=""
PLATFORM="twitter"
PORT=5055
SCENARIO=""
SIM_ID="sim_$(date +%s)"
SEED_POSTS=""
CONTEXT_FILE=""
WEB_SEARCH=""
MAX_SEARCHES=""
FACT_CHECK=""
NO_FACT_CHECK=""
FACT_CHECK_RATE=""

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --scenario)      SCENARIO="$2"; shift 2;;
    --count)         COUNT="$2"; shift 2;;
    --max-rounds)    MAX_ROUNDS="$2"; shift 2;;
    --platform)      PLATFORM="$2"; shift 2;;
    --port)          PORT="$2"; shift 2;;
    --sim-id)        SIM_ID="$2"; shift 2;;
    --seed-posts)    SEED_POSTS="$2"; shift 2;;
    --context-file)  CONTEXT_FILE="$2"; shift 2;;
    --web-search)     WEB_SEARCH="yes"; shift 1;;
    --max-searches-per-agent) MAX_SEARCHES="$2"; shift 2;;
    --fact-check)      FACT_CHECK="yes"; shift 1;;
    --no-fact-check)   NO_FACT_CHECK="yes"; shift 1;;
    --fact-check-rate) FACT_CHECK_RATE="$2"; shift 2;;
    *) echo "Unknown arg: $1" >&2; exit 1;;
  esac
done

if [[ -z "$SCENARIO" ]]; then
  echo "Error: --scenario is required" >&2
  exit 1
fi

SIM_DIR="$HOME/.x-lens/simulations/$SIM_ID"
LOG_FILE="$SIM_DIR/pipeline.log"
mkdir -p "$SIM_DIR"

# Copy files into sim dir
[[ -n "$SEED_POSTS" && -f "$SEED_POSTS" ]] && cp "$SEED_POSTS" "$SIM_DIR/seed_posts.json"
[[ -n "$CONTEXT_FILE" && -f "$CONTEXT_FILE" ]] && cp "$CONTEXT_FILE" "$SIM_DIR/context.md"

# Build worker args
WORKER_ARGS=(
  --scenario "$SCENARIO"
  --count "$COUNT"
  --platform "$PLATFORM"
  --port "$PORT"
  --sim-id "$SIM_ID"
)
[[ -n "$MAX_ROUNDS" ]] && WORKER_ARGS+=(--max-rounds "$MAX_ROUNDS")
[[ -f "$SIM_DIR/seed_posts.json" ]] && WORKER_ARGS+=(--seed-posts "$SIM_DIR/seed_posts.json")
[[ -f "$SIM_DIR/context.md" ]] && WORKER_ARGS+=(--context-file "$SIM_DIR/context.md")
[[ -n "$WEB_SEARCH" ]] && WORKER_ARGS+=(--web-search)
[[ -n "$MAX_SEARCHES" ]] && WORKER_ARGS+=(--max-searches-per-agent "$MAX_SEARCHES")
[[ -n "$FACT_CHECK" ]] && WORKER_ARGS+=(--fact-check)
[[ -n "$NO_FACT_CHECK" ]] && WORKER_ARGS+=(--no-fact-check)
[[ -n "$FACT_CHECK_RATE" ]] && WORKER_ARGS+=(--fact-check-rate "$FACT_CHECK_RATE")

# Launch worker in background
nohup "$SCRIPT_DIR/simulate-worker.sh" "${WORKER_ARGS[@]}" > "$LOG_FILE" 2>&1 &

WORKER_PID=$!

echo "=== x-lens simulation launched ==="
echo "SIM_ID:     $SIM_ID"
echo "SIM_DIR:    $SIM_DIR"
echo "DASHBOARD:  http://localhost:$PORT"
echo "LOG:        $LOG_FILE"
echo "WORKER_PID: $WORKER_PID"
[[ -f "$SIM_DIR/seed_posts.json" ]] && echo "SEEDS:      $SIM_DIR/seed_posts.json"
[[ -f "$SIM_DIR/context.md" ]] && echo "CONTEXT:    $SIM_DIR/context.md"
echo ""
echo "Pipeline is running in the background. Monitor with:"
echo "  tail -f $LOG_FILE"
echo "  curl http://localhost:$PORT/api/status"
echo ""
echo "The dashboard will go live immediately."
echo "The report will be saved to: $SIM_DIR/report.md"
