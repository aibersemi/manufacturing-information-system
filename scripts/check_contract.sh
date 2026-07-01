#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"

cleanup() {
	rm -rf "$TMP_DIR"
}
trap cleanup EXIT

cd "$ROOT_DIR"

SCHEMA_TMP="$TMP_DIR/frontend/schema.json"
GENERATED_TMP="$TMP_DIR/frontend/src/api/generated"
mkdir -p "$(dirname "$SCHEMA_TMP")" "$TMP_DIR/frontend/src/lib"
cp frontend/src/lib/request-client.ts "$TMP_DIR/frontend/src/lib/request-client.ts"

.venv/bin/python scripts/export_schema.py "$SCHEMA_TMP"
diff -u frontend/schema.json "$SCHEMA_TMP"

ORVAL_SCHEMA_TARGET="$SCHEMA_TMP" \
ORVAL_OUTPUT_TARGET="$GENERATED_TMP/endpoints.ts" \
ORVAL_OUTPUT_SCHEMAS="$GENERATED_TMP/models" \
ORVAL_MUTATOR_PATH="$TMP_DIR/frontend/src/lib/request-client.ts" \
npx orval --config orval.config.ts

.venv/bin/python scripts/normalize_generated.py "$GENERATED_TMP"
diff -ru frontend/src/api/generated "$GENERATED_TMP"
