#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
FRONTEND_DIR=$(dirname "$SCRIPT_DIR")
REPOSITORY_DIR=$(dirname "$FRONTEND_DIR")
OUTPUT_DIR="$FRONTEND_DIR/openapi"
OUTPUT_FILE="$OUTPUT_DIR/openapi.json"
TEMP_FILE="$OUTPUT_FILE.tmp"

# Application import validates configuration even though schema export never
# starts the server or signs tokens. Keep runtime secrets out of this workflow.
JWT_SECRET=${JWT_SECRET:-openapi-export-placeholder-not-for-runtime}
export JWT_SECRET

mkdir -p "$OUTPUT_DIR"
trap 'rm -f "$TEMP_FILE"' EXIT HUP INT TERM

docker compose \
  --project-directory "$REPOSITORY_DIR" \
  --env-file "$REPOSITORY_DIR/.env" \
  -f "$REPOSITORY_DIR/docker-compose.yml" \
  run --rm --no-deps backend \
  python -c 'import json; from app.main import app; print(json.dumps(app.openapi(), indent=2, sort_keys=True))' \
  > "$TEMP_FILE"

mv "$TEMP_FILE" "$OUTPUT_FILE"
trap - EXIT HUP INT TERM

echo "Exported $OUTPUT_FILE"
