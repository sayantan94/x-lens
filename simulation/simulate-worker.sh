#!/usr/bin/env bash
# Simulation worker — runs the full pipeline. Called by simulate.sh, not directly.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Defaults
COUNT=10
MAX_ROUNDS=30
PLATFORM="twitter"
PORT=5055
SCENARIO=""
SIM_ID=""

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --scenario)  SCENARIO="$2"; shift 2;;
    --count)     COUNT="$2"; shift 2;;
    --max-rounds) MAX_ROUNDS="$2"; shift 2;;
    --platform)  PLATFORM="$2"; shift 2;;
    --port)      PORT="$2"; shift 2;;
    --sim-id)    SIM_ID="$2"; shift 2;;
    *) shift;;
  esac
done

SIM_DIR="$HOME/.x-lens/simulations/$SIM_ID"

# Activate venv
source "$SCRIPT_DIR/.venv/bin/activate"

echo "=== x-lens simulation pipeline ==="
echo "SIM_ID:   $SIM_ID"
echo "AGENTS:   $COUNT"
echo "ROUNDS:   $MAX_ROUNDS"
echo "PLATFORM: $PLATFORM"
echo ""

# Step 1: Generate profiles
echo "[1/5] Generating agent profiles..."
python3 -m src.generate_profiles \
  --scenario "$SCENARIO" \
  --count "$COUNT" \
  --output "$SIM_DIR/profiles.json"
echo "  Done: $(wc -c < "$SIM_DIR/profiles.json") bytes"

# Step 2: Generate config
echo "[2/5] Generating simulation config..."
python3 -m src.generate_config \
  --profiles "$SIM_DIR/profiles.json" \
  --scenario "$SCENARIO" \
  --sim-id "$SIM_ID" \
  --output "$SIM_DIR/simulation_config.json"
echo "  Done."

# Step 3: Start dashboard (background)
echo "[3/5] Starting dashboard on port $PORT..."
lsof -ti :"$PORT" 2>/dev/null | xargs kill 2>/dev/null || true
sleep 1
python3 -m src.dashboard --sim-dir "$SIM_DIR" --port "$PORT" &
DASHBOARD_PID=$!
echo "  Dashboard PID: $DASHBOARD_PID → http://localhost:$PORT"

# Step 4: Run simulation (background — stays alive for IPC interviews)
echo "[4/5] Running simulation ($MAX_ROUNDS rounds on $PLATFORM)..."
python3 -m src.run_simulation \
  --config "$SIM_DIR/simulation_config.json" \
  --profiles "$SIM_DIR/profiles.json" \
  --platform "$PLATFORM" \
  --max-rounds "$MAX_ROUNDS" &
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

# Kill the IPC server
kill "$SIM_PID" 2>/dev/null || true
