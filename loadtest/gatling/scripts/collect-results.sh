#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${script_dir}/common.sh"
load_loadtest_environment

require_command git
require_command python3

if [[ ! -d "${LOADTEST_RESULTS_DIR}" ]]; then
  echo "Results directory does not exist: ${LOADTEST_RESULTS_DIR}" >&2
  exit 2
fi

if ! find "${LOADTEST_RESULTS_DIR}" -mindepth 1 -type f -print -quit | grep -q .; then
  echo "No result files found in ${LOADTEST_RESULTS_DIR}" >&2
  exit 2
fi

if grep -R -E -l \
  '(Bearer[[:space:]]+)?eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' \
  "${LOADTEST_RESULTS_DIR}" >/dev/null 2>&1; then
  echo "Refusing archive: a JWT pattern was found in the result files." >&2
  exit 3
fi

run_id="${RUN_ID:-$(date -u +%Y%m%d-%H%M%S)}"
artifact_root="${LOADTEST_ARTIFACT_DIR:-${repo_root}/loadtest/artifacts}"
bundle_name="support-chat-${run_id}"
bundle_dir="${artifact_root}/${bundle_name}"
archive_path="${artifact_root}/${bundle_name}.zip"

if [[ -e "${bundle_dir}" || -e "${archive_path}" ]]; then
  echo "Artifact already exists for RUN_ID=${run_id}" >&2
  exit 4
fi

mkdir -p "${bundle_dir}/results"
cp -R "${LOADTEST_RESULTS_DIR}/." "${bundle_dir}/results/"

{
  echo "run_id=${run_id}"
  echo "collected_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "git_sha=$(git -C "${repo_root}" rev-parse HEAD)"
  echo "git_branch=$(git -C "${repo_root}" branch --show-current)"
  echo "http_base_url=${LOADTEST_HTTP_BASE_URL}"
  echo "ws_url=${LOADTEST_WS_URL}"
  echo "management_base_url=${LOADTEST_MANAGEMENT_BASE_URL}"
  echo ""
  echo "git_status:"
  git -C "${repo_root}" status --short
  echo ""
  echo "files:"
  find "${bundle_dir}/results" -type f -printf '%P\n' | sort
} > "${bundle_dir}/manifest.txt"

(
  cd "${artifact_root}"
  python3 -m zipfile -c "${bundle_name}.zip" "${bundle_name}"
)

echo "Result archive created without runtime tokens or .env files:"
echo "  ${archive_path}"
