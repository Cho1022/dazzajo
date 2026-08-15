#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${script_dir}/common.sh"
load_loadtest_environment

usage() {
  cat <<'USAGE'
Usage: bash ./scripts/run-baseline.sh connection|message|all|stress

  connection  Smoke, then the connection-only baseline
  message     Smoke, then the message baseline
  all         Smoke, connection baseline, then message baseline
  stress      Run 500ms message stress after a wrapper-verified message baseline
USAGE
}

mode="${1:-}"
case "${mode}" in
  connection|message|all|stress) ;;
  *)
    usage >&2
    exit 2
    ;;
esac

marker_file="${project_dir}/runtime/message-baseline-passed.env"

run_profile() {
  local profile="$1"
  local simulation summary_name verify_option

  case "${profile}" in
    connection)
      simulation="com.buildgraph.loadtest.SupportChatConnectionBaselineSimulation"
      summary_name="support-chat-connection-baseline"
      verify_option="--connection-only"
      ;;
    message)
      simulation="com.buildgraph.loadtest.SupportChatMessageBaselineSimulation"
      summary_name="support-chat-message-baseline"
      verify_option=""
      ;;
    stress)
      simulation="com.buildgraph.loadtest.SupportChatMessageStressSimulation"
      summary_name="support-chat-message-stress-500ms"
      verify_option=""
      ;;
  esac

  echo "[${profile}] Resetting dedicated data"
  bash "${script_dir}/prepare-data.sh"

  echo "[${profile}] Preparing fresh real-login tokens"
  python3 "${script_dir}/prepare-tokens.py" \
    --minimum-valid-seconds 660

  echo "[${profile}] Running ${simulation}"
  local simulation_started_at
  simulation_started_at="$(date +%s)"
  run_gatling_simulation "${simulation}"

  echo "[${profile}] Verifying summary"
  summary_args=(
    --results-dir "${LOADTEST_RESULTS_DIR}"
    --simulation "${summary_name}"
    --not-before-epoch "${simulation_started_at}"
  )
  if [[ -n "${verify_option}" ]]; then
    summary_args+=("${verify_option}")
  fi
  python3 "${script_dir}/verify-summary.py" "${summary_args[@]}"

  if [[ "${profile}" == "message" ]]; then
    mkdir -p "$(dirname "${marker_file}")"
    {
      printf 'git_sha=%s\n' "$(git -C "${repo_root}" rev-parse HEAD)"
      printf 'http_base_url=%s\n' "${LOADTEST_HTTP_BASE_URL}"
      printf 'ws_url=%s\n' "${LOADTEST_WS_URL}"
      printf 'completed_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } > "${marker_file}"
    echo "Message baseline gate recorded: ${marker_file}"
  fi
}

if [[ "${mode}" == "stress" ]]; then
  bash "${script_dir}/preflight.sh"
  if [[ ! -f "${marker_file}" ]]; then
    echo "Stress blocked: run the message baseline with this wrapper first." >&2
    echo "Run: bash ./scripts/run-baseline.sh message" >&2
    exit 5
  fi

  expected_sha="$(git -C "${repo_root}" rev-parse HEAD)"
  marker_sha="$(sed -n 's/^git_sha=//p' "${marker_file}")"
  marker_target="$(sed -n 's/^http_base_url=//p' "${marker_file}")"
  marker_ws_target="$(sed -n 's/^ws_url=//p' "${marker_file}")"
  if [[ "${marker_sha}" != "${expected_sha}" \
     || "${marker_target}" != "${LOADTEST_HTTP_BASE_URL}" \
     || "${marker_ws_target}" != "${LOADTEST_WS_URL}" ]]; then
    echo "Stress blocked: the verified message baseline used a different commit or target." >&2
    echo "Run: bash ./scripts/run-baseline.sh message" >&2
    exit 5
  fi

  run_profile stress
  exit 0
fi

echo "[Gate] Running mandatory Smoke first"
bash "${script_dir}/run-smoke.sh"

case "${mode}" in
  connection)
    run_profile connection
    ;;
  message)
    run_profile message
    ;;
  all)
    run_profile connection
    run_profile message
    ;;
esac

echo "${mode} baseline workflow passed."
