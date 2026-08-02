#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${LOADTEST_DATABASE_URL:?LOADTEST_DATABASE_URL is required}"

if [[ "${LOADTEST_CONFIRM_NON_PROD:-}" != "YES" ]]; then
  echo "Refusing DB verification: LOADTEST_CONFIRM_NON_PROD must be YES." >&2
  exit 2
fi

psql "${LOADTEST_DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${script_dir}/verify-smoke.sql"
