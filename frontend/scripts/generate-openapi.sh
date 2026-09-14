#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
FRONTEND_DIR=$(dirname "$SCRIPT_DIR")
GENERATED_DIR="$FRONTEND_DIR/src/app/api/generated"
NEXT_DIR="$FRONTEND_DIR/src/app/api/generated.next"
PREVIOUS_DIR="$FRONTEND_DIR/src/app/api/generated.previous"

if [ ! -f "$FRONTEND_DIR/openapi/openapi.json" ]; then
  echo "Missing openapi/openapi.json. Run npm run openapi:export first." >&2
  exit 1
fi

cleanup() {
  rm -rf "$NEXT_DIR" "$PREVIOUS_DIR"
}

trap cleanup EXIT HUP INT TERM
cleanup

cd "$FRONTEND_DIR"
npx openapi-generator-cli generate \
  --config openapi-generator-config.yaml \
  --openapi-generator-ignore-list api.module.ts,index.ts,git_push.sh,README.md \
  --output "$NEXT_DIR"
npx prettier --write "$NEXT_DIR/**/*.ts"

if [ -d "$GENERATED_DIR" ]; then
  mv "$GENERATED_DIR" "$PREVIOUS_DIR"
fi
mv "$NEXT_DIR" "$GENERATED_DIR"
rm -rf "$PREVIOUS_DIR"
trap - EXIT HUP INT TERM
