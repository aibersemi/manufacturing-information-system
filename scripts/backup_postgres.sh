#!/usr/bin/env bash
set -euo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-/data/backups/manufacturing-information-system/postgres}"
WAL_ARCHIVE_DIR="${WAL_ARCHIVE_DIR:-${BACKUP_ROOT}/wal}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="${BACKUP_ROOT}/${STAMP}"
PG_VERIFYBACKUP="${PG_VERIFYBACKUP:-/usr/lib/postgresql/17/bin/pg_verifybackup}"

umask 077
STARTED_AT="$(date --iso-8601=seconds)"
install -d -m 0700 "${BACKUP_ROOT}" "${WAL_ARCHIVE_DIR}" "${TARGET}"

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

psql_setting() {
  psql -d postgres -Atqc "show $1"
}

pg_stat_archiver_snapshot() {
  psql -d postgres -Atqc "select archived_count, failed_count, coalesce(last_archived_wal, ''), coalesce(last_archived_time::text, ''), coalesce(last_failed_wal, ''), coalesce(last_failed_time::text, '') from pg_stat_archiver"
}

SERVER_VERSION="$(psql_setting server_version)"
WAL_LEVEL="$(psql_setting wal_level)"
ARCHIVE_MODE="$(psql_setting archive_mode)"
ARCHIVE_COMMAND="$(psql_setting archive_command)"
ARCHIVER_BEFORE="$(pg_stat_archiver_snapshot)"
ARCHIVER_BEFORE_COUNT="${ARCHIVER_BEFORE%%|*}"

pg_basebackup \
  --pgdata="${TARGET}" \
  --format=plain \
  --wal-method=stream \
  --checkpoint=fast \
  --manifest-checksums=SHA256 \
  --progress
"${PG_VERIFYBACKUP}" "${TARGET}"
psql -d postgres -Atqc "select pg_switch_wal()" >/dev/null
FINISHED_AT="$(date --iso-8601=seconds)"
ARCHIVER_AFTER="$(pg_stat_archiver_snapshot)"
for _ in {1..10}; do
  ARCHIVER_AFTER_COUNT="${ARCHIVER_AFTER%%|*}"
  if (( ARCHIVER_AFTER_COUNT > ARCHIVER_BEFORE_COUNT )); then
    break
  fi
  sleep 1
  ARCHIVER_AFTER="$(pg_stat_archiver_snapshot)"
done
date --iso-8601=seconds > "${TARGET}/verified-at.txt"
cat > "${TARGET}/wal-archive-status.txt" <<EOF
before=${ARCHIVER_BEFORE}
after=${ARCHIVER_AFTER}
EOF
cat > "${TARGET}/manifest.json" <<EOF
{
  "backup_type": "postgres_basebackup",
  "backup_started_at": "$(json_escape "${STARTED_AT}")",
  "backup_finished_at": "$(json_escape "${FINISHED_AT}")",
  "backup_root": "$(json_escape "${BACKUP_ROOT}")",
  "backup_path": "$(json_escape "${TARGET}")",
  "wal_archive_path": "$(json_escape "${WAL_ARCHIVE_DIR}")",
  "pg_version": "$(json_escape "${SERVER_VERSION}")",
  "wal_level": "$(json_escape "${WAL_LEVEL}")",
  "archive_mode": "$(json_escape "${ARCHIVE_MODE}")",
  "archive_command": "$(json_escape "${ARCHIVE_COMMAND}")",
  "pg_verifybackup_status": "ok",
  "restore_drill_status": "not_run",
  "retention_days": ${RETENTION_DAYS}
}
EOF
find "${BACKUP_ROOT}" \
  -mindepth 1 \
  -maxdepth 1 \
  -type d \
  -regextype posix-extended \
  -regex '.*/[0-9]{8}-[0-9]{6}' \
  -mtime "+${RETENTION_DAYS}" \
  -exec rm -rf -- {} +
