#!/usr/bin/env bash
# Build all workspaces and drop into x-lens REPL.
# Extra args are forwarded to x-lens (e.g. ./repl.sh --persona trader --visible).
set -euo pipefail

cd "$(cd "$(dirname "$0")" && pwd)"

echo "→ building workspaces..."
npm run build

echo "→ launching x-lens REPL..."
exec node app/dist/main.js "$@"
