#!/bin/sh
set -e

SELF_DIR="$(dirname "$0")";

cd "$SELF_DIR";
npx rollup -c rollup.config.mjs;
cd - >/dev/null;

SIZE="$(wc -c < "$SELF_DIR/mini.output.mjs")";

echo "mini.output.mjs: $SIZE bytes"
if [ "$SIZE" -gt "15000" ]; then
  echo "Failed to tree shake a minimal application sufficiently - see $SELF_DIR/mini.output.mjs ($SIZE bytes)" >&2;
  exit 1;
fi;
rm "$SELF_DIR/mini.output.mjs";
