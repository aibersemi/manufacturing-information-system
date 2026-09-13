#!/usr/bin/env bash
set -e

# Lokasi file .env
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ENV="$PROJECT_ROOT/.env"
SUPABASE_ENV="/opt/services/supabase/.env"

# Ambil konfigurasi database dari .env proyek
if [ -f "$PROJECT_ENV" ]; then
  PG_HOST_VAL=$(grep -E "^POSTGRES_HOST=" "$PROJECT_ENV" | head -n 1 | cut -d '=' -f2-)
  PG_PORT_VAL=$(grep -E "^POSTGRES_PORT=" "$PROJECT_ENV" | head -n 1 | cut -d '=' -f2-)
  PG_DB_VAL=$(grep -E "^POSTGRES_DB=" "$PROJECT_ENV" | head -n 1 | cut -d '=' -f2-)
  PG_USER_VAL=$(grep -E "^POSTGRES_USER=" "$PROJECT_ENV" | head -n 1 | cut -d '=' -f2-)
  PG_PASS_VAL=$(grep -E "^POSTGRES_PASSWORD=" "$PROJECT_ENV" | head -n 1 | cut -d '=' -f2-)
fi

# Fallback & tenant identifier dari .env Supabase lokal (jika diperlukan oleh pooler)
if [ -f "$SUPABASE_ENV" ]; then
  PG_TENANT=$(grep -E "^POOLER_TENANT_ID=" "$SUPABASE_ENV" | head -n 1 | cut -d '=' -f2-)
  [ -z "$PG_HOST_VAL" ] && PG_HOST_VAL=$(grep -E "^POSTGRES_HOST=" "$SUPABASE_ENV" | head -n 1 | cut -d '=' -f2-)
  [ -z "$PG_PORT_VAL" ] && PG_PORT_VAL=$(grep -E "^POSTGRES_PORT=" "$SUPABASE_ENV" | head -n 1 | cut -d '=' -f2-)
  [ -z "$PG_DB_VAL" ] && PG_DB_VAL=$(grep -E "^POSTGRES_DB=" "$SUPABASE_ENV" | head -n 1 | cut -d '=' -f2-)
  [ -z "$PG_PASS_VAL" ] && PG_PASS_VAL=$(grep -E "^POSTGRES_PASSWORD=" "$SUPABASE_ENV" | head -n 1 | cut -d '=' -f2-)
fi

# Sesuaikan format user untuk pooler Supavisor jika belum memiliki suffix tenant
if [ -n "$PG_TENANT" ] && [[ "$PG_USER_VAL" != *"$PG_TENANT"* ]]; then
  PG_USER_VAL="${PG_USER_VAL:-postgres}.${PG_TENANT}"
fi

export PG_HOST="$PG_HOST_VAL"
export PG_PORT="$PG_PORT_VAL"
export PG_USER="$PG_USER_VAL"
export PG_PASSWORD="$PG_PASS_VAL"
export PG_DATABASE="$PG_DB_VAL"
export PG_ALLOW_WRITE="true"

exec npx -y mcp-postgres-server
