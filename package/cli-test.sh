#!/bin/sh
set -e
BASEDIR="$(dirname "$0")"

EXPECTED="web-listener 0.5.0";

ACTUAL="$(npm --prefix "$BASEDIR" exec --offline -- web-listener --version)";

if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "Unexpected output from CLI" >&2;
  echo "$ACTUAL" >&2;
  exit 1;
fi;

TEST_DIR="$(mktemp -d)";
if [ -z "$TEST_DIR" ] || ! [ -d "$TEST_DIR" ]; then
  echo "Failed to create test directory" >&2;
  exit 1;
fi;

echo 'Test compressible file content..............................' > "$TEST_DIR/file.txt";
npm --prefix "$BASEDIR" exec --offline -- web-listener "$TEST_DIR" --write-compressed --min-compress 1 --gzip --no-serve;
if ! [ -f "$TEST_DIR/file.txt.gz" ]; then
  echo "Failed to generate compressed file" >&2;
  ls -al "$TEST_DIR" >&2;
  rm -r "$TEST_DIR";
  exit 1;
fi;
rm -r "$TEST_DIR";

"$BASEDIR/cli-run.mjs"
