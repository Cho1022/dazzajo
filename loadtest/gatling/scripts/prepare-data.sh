#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"
runtime_dir="${project_dir}/runtime"

: "${LOADTEST_DATABASE_URL:?LOADTEST_DATABASE_URL is required}"
: "${LOADTEST_ACCOUNT_PASSWORD:?LOADTEST_ACCOUNT_PASSWORD is required}"

if [[ "${LOADTEST_CONFIRM_NON_PROD:-}" != "YES" ]]; then
  echo "Refusing to prepare data: LOADTEST_CONFIRM_NON_PROD must be YES." >&2
  exit 2
fi

mkdir -p "${runtime_dir}"

psql "${LOADTEST_DATABASE_URL}" \
  -v ON_ERROR_STOP=1 \
  -v loadtest_confirm_non_prod="${LOADTEST_CONFIRM_NON_PROD}" \
  -v loadtest_password="${LOADTEST_ACCOUNT_PASSWORD}" \
  -f "${script_dir}/prepare-data.sql"

psql "${LOADTEST_DATABASE_URL}" --csv -v ON_ERROR_STOP=1 \
  -c "
    SELECT 'USER' AS kind,
           row_number() OVER (ORDER BY room.public_id) AS account_index,
           load_user.email,
           room.public_id AS room_id
    FROM support_chat_rooms room
    JOIN users load_user ON load_user.id = room.user_id
    WHERE room.public_id::text LIKE '40000000-0000-0000-0000-%'
      AND room.status = 'ACTIVE'
      AND room.deleted_at IS NULL
    UNION ALL
    SELECT 'ADMIN' AS kind,
           row_number() OVER (ORDER BY load_admin.email) AS account_index,
           load_admin.email,
           NULL::uuid AS room_id
    FROM users load_admin
    WHERE load_admin.email LIKE 'loadtest-admin-%@example.invalid'
      AND load_admin.role = 'ADMIN'
      AND load_admin.deleted_at IS NULL
    ORDER BY kind DESC, account_index
  " > "${runtime_dir}/accounts.csv"

echo "Prepared 150 users, 10 admins, 150 tickets, and 150 ACTIVE rooms."
echo "Account manifest: ${runtime_dir}/accounts.csv"
