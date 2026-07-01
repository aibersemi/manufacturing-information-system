#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Penggunaan: $0 /data/backups/manufacturing-information-system/postgres/<timestamp> [recovery_target_time]" >&2
  exit 2
fi

SOURCE="$(realpath "$1")"
if [[ ! -f "${SOURCE}/PG_VERSION" && -f "${SOURCE}/postgres/PG_VERSION" ]]; then
  SOURCE="$(realpath "${SOURCE}/postgres")"
fi
if [[ ! -f "${SOURCE}/PG_VERSION" ]]; then
  echo "Backup PostgreSQL tidak valid: ${SOURCE}" >&2
  exit 2
fi

if [[ "$(basename "$(dirname "${SOURCE}")")" == "postgres" ]]; then
  RESULT_DIR="${SOURCE}"
else
  RESULT_DIR="$(dirname "${SOURCE}")"
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
WORK_DIR="$(mktemp -d -p "${TMPDIR:-/tmp}" "mis-restore-${STAMP}.XXXXXXXX")"
TARGET="${WORK_DIR}/data"
SOCKET_DIR="${WORK_DIR}/socket"
PORT="${RESTORE_TEST_PORT:-55432}"
MAX_CONNECTIONS="${RESTORE_TEST_MAX_CONNECTIONS:-200}"
PG_CTL="/usr/lib/postgresql/17/bin/pg_ctl"
MANUFACTURING_DB="${MANUFACTURING_DB:-manufacturing_is}"
WAL_ARCHIVE_DIR="${WAL_ARCHIVE_DIR:-/data/backups/manufacturing-information-system/postgres/wal}"
RECOVERY_TARGET_TIME="${2:-${RECOVERY_TARGET_TIME:-}}"
RECOVERY_TARGET_NAME="${RECOVERY_TARGET_NAME:-}"
if [[ "${RECOVERY_TARGET_TIME}" == *"'"* || "${RECOVERY_TARGET_NAME}" == *"'"* ]]; then
  echo "Target recovery tidak boleh memuat kutip tunggal." >&2
  exit 2
fi
RESTORE_STATUS="failed"
RESULT_FILE="${RESULT_DIR}/restore-test-${STAMP}.txt"

cleanup() {
  if [[ -f "${TARGET}/postmaster.pid" ]]; then
    "${PG_CTL}" -D "${TARGET}" -m immediate stop >/dev/null 2>&1 || true
  fi
  if [[ "${RESTORE_STATUS}" != "ok" && -d "${RESULT_DIR}" ]]; then
    {
      printf 'verified_at=%s\n' "$(date --iso-8601=seconds)"
      printf 'status=failed\n'
      printf 'backup_path=%s\n' "${SOURCE}"
      printf 'wal_archive_dir=%s\n' "${WAL_ARCHIVE_DIR}"
      printf 'recovery_target_time=%s\n' "${RECOVERY_TARGET_TIME:-latest}"
      printf 'recovery_target_name=%s\n' "${RECOVERY_TARGET_NAME:-}"
    } > "${RESULT_FILE}" || true
  fi
  rm -rf -- "${WORK_DIR}"
}
trap cleanup EXIT

mkdir -m 0700 "${TARGET}" "${SOCKET_DIR}"
cp -a --reflink=auto "${SOURCE}/." "${TARGET}/"
rm -f "${TARGET}/standby.signal"
cat > "${TARGET}/postgresql.conf" <<EOF
data_directory = '${TARGET}'
port = ${PORT}
listen_addresses = ''
unix_socket_directories = '${SOCKET_DIR}'
max_connections = ${MAX_CONNECTIONS}
shared_buffers = 128MB
hba_file = '${TARGET}/pg_hba.conf'
restore_command = 'test -f ${WAL_ARCHIVE_DIR}/%f && cp ${WAL_ARCHIVE_DIR}/%f %p'
recovery_target_timeline = 'latest'
EOF
cat > "${TARGET}/pg_hba.conf" <<EOF
local all all trust
EOF
touch "${TARGET}/recovery.signal"
if [[ -n "${RECOVERY_TARGET_NAME}" ]]; then
  cat >> "${TARGET}/postgresql.conf" <<EOF
recovery_target_name = '${RECOVERY_TARGET_NAME}'
recovery_target_action = 'promote'
EOF
elif [[ -n "${RECOVERY_TARGET_TIME}" ]]; then
  cat >> "${TARGET}/postgresql.conf" <<EOF
recovery_target_time = '${RECOVERY_TARGET_TIME}'
recovery_target_action = 'promote'
EOF
fi

"${PG_CTL}" -D "${TARGET}" -o "-c config_file=${TARGET}/postgresql.conf" -w start
DATABASE_COUNT="$(psql -h "${SOCKET_DIR}" -p "${PORT}" -d postgres -Atqc "select count(*) from pg_database where datallowconn")"
psql -h "${SOCKET_DIR}" -p "${PORT}" -d "${MANUFACTURING_DB}" -Atqc "select 1" >/dev/null
"${PG_CTL}" -D "${TARGET}" -m fast -w stop
RESTORE_STATUS="ok"
{
  printf 'verified_at=%s\n' "$(date --iso-8601=seconds)"
  printf 'status=ok\n'
  printf 'backup_path=%s\n' "${SOURCE}"
  printf 'wal_archive_dir=%s\n' "${WAL_ARCHIVE_DIR}"
  printf 'recovery_target_time=%s\n' "${RECOVERY_TARGET_TIME:-latest}"
  printf 'recovery_target_name=%s\n' "${RECOVERY_TARGET_NAME:-}"
  printf 'database_count=%s\n' "${DATABASE_COUNT}"
  printf 'database_probe=%s\n' "${MANUFACTURING_DB}"
} > "${RESULT_FILE}"

if [[ -f "${RESULT_DIR}/manifest.json" ]]; then
  sed 's/"restore_drill_status": "[^"]*"/"restore_drill_status": "ok"/' \
    "${RESULT_DIR}/manifest.json" > "${RESULT_DIR}/manifest.json.tmp"
  mv "${RESULT_DIR}/manifest.json.tmp" "${RESULT_DIR}/manifest.json"
fi
