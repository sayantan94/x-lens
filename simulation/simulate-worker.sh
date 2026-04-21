#!/usr/bin/env bash
# Simulation worker — runs the full pipeline. Called by simulate.sh, not directly.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Defaults
COUNT=10
MAX_ROUNDS=""
PLATFORM="twitter"
PORT=5055
SCENARIO=""
SIM_ID=""
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
    *) shift;;
  esac
done

SIM_DIR="$HOME/.x-lens/simulations/$SIM_ID"

# Activate venv
source "$SCRIPT_DIR/.venv/bin/activate"

# Track every child we spawn so we can reliably clean them up on exit.
# Without this, dashboard + run_simulation Python processes leak as orphans
# whenever the worker is killed, times out, or the shell closes.
DASHBOARD_PID=""
SIM_PID=""
WORKER_PID_FILE="$SIM_DIR/.worker.pid"
echo "$$" > "$WORKER_PID_FILE"

cleanup() {
  local exit_code=$?
  # Kill children in reverse spawn order. `|| true` so cleanup itself never fails.
  if [[ -n "$SIM_PID" ]]; then
    kill -TERM "$SIM_PID" 2>/dev/null || true
    # Give it 3s to exit gracefully, then SIGKILL.
    for _ in 1 2 3; do
      kill -0 "$SIM_PID" 2>/dev/null || break
      sleep 1
    done
    kill -KILL "$SIM_PID" 2>/dev/null || true
  fi
  if [[ -n "$DASHBOARD_PID" ]]; then
    kill -TERM "$DASHBOARD_PID" 2>/dev/null || true
    sleep 1
    kill -KILL "$DASHBOARD_PID" 2>/dev/null || true
  fi
  rm -f "$WORKER_PID_FILE" 2>/dev/null || true
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "=== x-lens simulation pipeline ==="
echo "SIM_ID:   $SIM_ID"
echo "AGENTS:   $COUNT"
echo "ROUNDS:   $MAX_ROUNDS"
echo "PLATFORM: $PLATFORM"
echo ""

# Step 1: Start dashboard (or reuse existing one on the same port)
echo "[1/5] Dashboard on port $PORT..."
DASHBOARD_PID=""
if curl -sf "http://localhost:$PORT/api/status" >/dev/null 2>&1; then
  echo "  Reusing existing dashboard on port $PORT"
else
  lsof -ti :"$PORT" 2>/dev/null | xargs kill 2>/dev/null || true
  sleep 1
  python3 -m src.dashboard --sim-dir "$SIM_DIR" --port "$PORT" &
  DASHBOARD_PID=$!
  echo "  Dashboard PID: $DASHBOARD_PID → http://localhost:$PORT"
fi

# Step 2: Generate profiles
echo "[2/5] Generating agent profiles..."
python3 -m src.generate_profiles \
  --scenario "$SCENARIO" \
  --count "$COUNT" \
  --output "$SIM_DIR/profiles.json"
echo "  Done: $(wc -c < "$SIM_DIR/profiles.json") bytes"

# Step 3: Generate config
echo "[3/5] Generating simulation config..."
CONFIG_ARGS=(
  --profiles "$SIM_DIR/profiles.json"
  --scenario "$SCENARIO"
  --sim-id "$SIM_ID"
  --output "$SIM_DIR/simulation_config.json"
)
[[ -n "$SEED_POSTS" && -f "$SEED_POSTS" ]] && CONFIG_ARGS+=(--seed-posts "$SEED_POSTS")
python3 -m src.generate_config "${CONFIG_ARGS[@]}"
echo "  Done."

# Step 4: Run simulation (background — stays alive for IPC interviews)
echo "[4/5] Running simulation (${MAX_ROUNDS:-all} rounds on $PLATFORM)..."
[[ -n "$MAX_ROUNDS" ]] && echo "$MAX_ROUNDS" > "$SIM_DIR/.max_rounds"
SIM_ARGS=(
  --config "$SIM_DIR/simulation_config.json"
  --profiles "$SIM_DIR/profiles.json"
  --platform "$PLATFORM"
)
[[ -n "$MAX_ROUNDS" ]] && SIM_ARGS+=(--max-rounds "$MAX_ROUNDS")
[[ -n "$CONTEXT_FILE" && -f "$CONTEXT_FILE" ]] && SIM_ARGS+=(--context-file "$CONTEXT_FILE")
[[ -n "$WEB_SEARCH" ]] && SIM_ARGS+=(--web-search)
[[ -n "$MAX_SEARCHES" ]] && SIM_ARGS+=(--max-searches-per-agent "$MAX_SEARCHES")
[[ -n "$FACT_CHECK" ]] && SIM_ARGS+=(--fact-check)
[[ -n "$NO_FACT_CHECK" ]] && SIM_ARGS+=(--no-fact-check)
[[ -n "$FACT_CHECK_RATE" ]] && SIM_ARGS+=(--fact-check-rate "$FACT_CHECK_RATE")
python3 -m src.run_simulation "${SIM_ARGS[@]}" &
SIM_PID=$!

# Wait for simulation_complete marker
while ! grep -q "simulation_complete" "$SIM_DIR/actions.jsonl" 2>/dev/null; do
  if ! kill -0 "$SIM_PID" 2>/dev/null; then
    echo "ERROR: Simulation process died" >&2
    exit 1
  fi
  sleep 5
done
echo "  Simulation finished."

# Step 5: Generate report
echo "[5/5] Generating report..."
python3 -m src.generate_report \
  --sim-dir "$SIM_DIR" \
  --scenario "$SCENARIO"

echo ""
echo "=== PIPELINE COMPLETE ==="
echo "Dashboard: http://localhost:$PORT"
echo "Report:    $SIM_DIR/report.md"

# Tell the cleanup trap that we reached the end successfully; it will tear
# down SIM_PID (IPC server) and DASHBOARD_PID on exit.
