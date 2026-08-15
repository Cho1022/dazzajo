#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${script_dir}/common.sh"
load_loadtest_environment

echo "[Smoke 1/5] Preflight"
bash "${script_dir}/preflight.sh"

echo "[Smoke 2/5] Preparing dedicated data"
bash "${script_dir}/prepare-data.sh"

echo "[Smoke 3/5] Preparing two real-login tokens"
python3 "${script_dir}/prepare-tokens.py" \
  --smoke-only --minimum-valid-seconds 120

echo "[Smoke 4/5] Running USER <-> ADMIN STOMP Smoke"
simulation_started_at="$(date +%s)"
run_gatling_simulation \
  com.buildgraph.loadtest.SupportChatSmokeSimulation

echo "[Smoke 5/5] Verifying summary and PostgreSQL rows"
python3 "${script_dir}/verify-summary.py" \
  --results-dir "${LOADTEST_RESULTS_DIR}" \
  --simulation support-chat-smoke \
  --not-before-epoch "${simulation_started_at}" \
  --smoke
bash "${script_dir}/verify-smoke.sh"

echo "Smoke passed. Baseline execution is now allowed."
