#!/usr/bin/env bash
# All-in-one simulation launcher. Returns immediately — runs pipeline in background.
# Usage: ./simulate.sh --scenario "..." [--count 10] [--max-rounds 30] [--platform twitter] [--port 5055]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Defaults
COUNT=10
MAX_ROUNDS=30
PLATFORM="twitter"
PORT=5055
SCENARIO=""
SIM_ID="sim_$(date +%s)"

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --scenario)  SCENARIO="$2"; shift 2;;
    --count)     COUNT="$2"; shift 2;;
    --max-rounds) MAX_ROUNDS="$2"; shift 2;;
    --platform)  PLATFORM="$2"; shift 2;;
    --port)      PORT="$2"; shift 2;;
    --sim-id)    SIM_ID="$2"; shift 2;;
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

# Launch worker in background
nohup "$SCRIPT_DIR/simulate-worker.sh" \
  --scenario "$SCENARIO" \
  --count "$COUNT" \
  --max-rounds "$MAX_ROUNDS" \
  --platform "$PLATFORM" \
  --port "$PORT" \
  --sim-id "$SIM_ID" \
  > "$LOG_FILE" 2>&1 &

WORKER_PID=$!

echo "=== x-lens simulation launched ==="
echo "SIM_ID:     $SIM_ID"
echo "SIM_DIR:    $SIM_DIR"
echo "DASHBOARD:  http://localhost:$PORT"
echo "LOG:        $LOG_FILE"
echo "WORKER_PID: $WORKER_PID"
echo ""
echo "Pipeline is running in the background. Monitor with:"
echo "  tail -f $LOG_FILE"
echo "  curl http://localhost:$PORT/api/status"
echo ""
echo "The dashboard will go live once profiles and config are generated."
echo "The report will be saved to: $SIM_DIR/report.md"
