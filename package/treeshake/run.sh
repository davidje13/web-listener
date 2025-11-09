#!/bin/sh
set -e

SELF_DIR="$(dirname "$0")";

cd "$SELF_DIR";
npx rollup -c rollup.config.mjs;
cd - >/dev/null;

SIZE_MINI="$(wc -c < "$SELF_DIR/mini.output.mjs")";
SIZE_NANO="$(wc -c < "$SELF_DIR/nano.output.mjs")";

echo "mini.output.mjs: $SIZE_MINI bytes"
echo "nano.output.mjs: $SIZE_NANO bytes"
if [ "$SIZE_NANO" -gt "500" ]; then
  echo "Failed to tree shake an empty application sufficiently - see $SELF_DIR/nano.output.mjs" >&2;
  exit 1;
fi;
if [ "$SIZE_MINI" -gt "15000" ]; then
  echo "Failed to tree shake a minimal application sufficiently - see $SELF_DIR/mini.output.mjs" >&2;
  exit 1;
fi;
rm "$SELF_DIR/mini.output.mjs";
rm "$SELF_DIR/nano.output.mjs";
