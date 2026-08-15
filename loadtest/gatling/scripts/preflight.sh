#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${script_dir}/common.sh"
load_loadtest_environment

echo "[1/5] Checking required commands"
for command_name in curl git java psql python3; do
  require_command "${command_name}"
done

java_version_line="$(java -version 2>&1 | head -n 1)"
if ! grep -E 'version "21([."]|$)' <<<"${java_version_line}" >/dev/null; then
  echo "Java 21 is required; found: ${java_version_line}" >&2
  exit 2
fi

if [[ ! -x "${repo_root}/apps/api/gradlew" ]]; then
  echo "Gradle wrapper is not executable: ${repo_root}/apps/api/gradlew" >&2
  echo "Run: chmod +x ${repo_root}/apps/api/gradlew" >&2
  exit 2
fi

echo "[2/5] Checking required environment"
: "${LOADTEST_DATABASE_URL:?LOADTEST_DATABASE_URL is required}"
: "${LOADTEST_ACCOUNT_PASSWORD:?LOADTEST_ACCOUNT_PASSWORD is required}"

if [[ "${LOADTEST_CONFIRM_NON_PROD:-}" != "YES" ]]; then
  echo "Refusing load test: LOADTEST_CONFIRM_NON_PROD must be YES." >&2
  exit 2
fi

if [[ "${LOADTEST_DATABASE_URL}" == *"CHANGE_ME"* \
   || "${LOADTEST_ACCOUNT_PASSWORD}" == "CHANGE_ME" ]]; then
  echo "Replace CHANGE_ME values in the load-test environment file." >&2
  exit 2
fi

echo "[3/5] Checking PostgreSQL connectivity"
database_probe="$(psql "${LOADTEST_DATABASE_URL}" -v ON_ERROR_STOP=1 -Atqc 'SELECT 1')"
if [[ "${database_probe}" != "1" ]]; then
  echo "PostgreSQL probe returned an unexpected value: ${database_probe}" >&2
  exit 3
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

echo "[4/5] Checking Spring Boot health"
curl -fsS --max-time 10 \
  "${LOADTEST_MANAGEMENT_BASE_URL%/}/actuator/health" \
  -o "${tmp_dir}/health.json"

python3 - "${tmp_dir}/health.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)

if payload.get("status") != "UP":
    raise SystemExit(f"Actuator health is not UP: {payload}")
PY

echo "[5/5] Checking Prometheus STOMP executor metrics"
curl -fsS --max-time 15 \
  "${LOADTEST_MANAGEMENT_BASE_URL%/}/actuator/prometheus" \
  -o "${tmp_dir}/prometheus.txt"

for executor_name in clientInboundChannelExecutor clientOutboundChannelExecutor; do
  for metric_name in \
    executor_pool_size_threads \
    executor_active_threads \
    executor_queued_tasks \
    executor_completed_tasks_total; do
    if ! grep -E "^${metric_name}\\{[^}]*name=\"${executor_name}\"" \
      "${tmp_dir}/prometheus.txt" >/dev/null; then
      echo "Missing Prometheus series: ${metric_name} name=${executor_name}" >&2
      exit 4
    fi
  done
done

mkdir -p "${LOADTEST_RESULTS_DIR}"

echo "Preflight passed."
echo "  Git SHA: $(git -C "${repo_root}" rev-parse --short HEAD)"
echo "  HTTP target: ${LOADTEST_HTTP_BASE_URL}"
echo "  WebSocket target: ${LOADTEST_WS_URL}"
echo "  Management target: ${LOADTEST_MANAGEMENT_BASE_URL}"
echo "  Results: ${LOADTEST_RESULTS_DIR}"
