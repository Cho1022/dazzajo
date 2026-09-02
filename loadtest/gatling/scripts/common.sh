#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"
repo_root="$(cd "${project_dir}/../.." && pwd)"

load_loadtest_environment() {
  local env_file="${LOADTEST_ENV_FILE:-${project_dir}/.env.loadtest}"

  if [[ -f "${env_file}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${env_file}"
    set +a
    echo "Loaded environment: ${env_file}"
  fi

  export LOADTEST_HTTP_BASE_URL="${LOADTEST_HTTP_BASE_URL:-http://172.31.10.173:8080}"
  export LOADTEST_WS_URL="${LOADTEST_WS_URL:-ws://172.31.10.173:8080/ws/support-chat}"
  export LOADTEST_MANAGEMENT_BASE_URL="${LOADTEST_MANAGEMENT_BASE_URL:-http://172.31.10.173:9091}"

  local configured_results_dir="${LOADTEST_RESULTS_DIR:-../results}"
  if [[ "${configured_results_dir}" = /* ]]; then
    export LOADTEST_RESULTS_DIR="${configured_results_dir}"
  else
    export LOADTEST_RESULTS_DIR="${project_dir}/${configured_results_dir}"
  fi
}

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
    return 1
  fi
}

run_gatling_simulation() {
  local simulation="$1"
  "${repo_root}/apps/api/gradlew" -p "${project_dir}" gatlingRun \
    --simulation "${simulation}" --no-daemon
}
