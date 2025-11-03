#!/bin/sh
set -e
BASEDIR="$(dirname "$0")"

EXPECTED="web-listener 0.1.0";

ACTUAL="$(npm --prefix "$BASEDIR" exec --offline -- web-listener --version)";

if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "Unexpected output from CLI" >&2;
  echo "$ACTUAL";
  exit 1;
fi;

"$BASEDIR/cli-run.mjs"
