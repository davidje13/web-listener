#!/bin/sh
set -e

echo "Running package test...";
echo;

BASE_DIR="$(cd "$(dirname "$0")/.."; pwd)";
cp "$BASE_DIR/package.tgz" "$BASE_DIR/package/web-listener.tgz";

cd "$BASE_DIR/package";
rm -rf node_modules/web-listener || true;
npm install --audit=false;
rm web-listener.tgz || true;
npm -s test;
cd - >/dev/null;

MANDOC_FILE="$BASE_DIR/package/node_modules/web-listener/man1/web-listener.1.gz"
if which mandoc >/dev/null; then
  # macOS
  gzip -dc "$MANDOC_FILE" | mandoc -T lint -W style;
elif which nroff >/dev/null; then
  # Linux
  WARNINGS="$(gzip -dc "$MANDOC_FILE" | nroff -mandoc -w all -W break 2>&1 >/dev/null)";
  if [ -n "$WARNINGS" ]; then
    echo "$WARNINGS";
    exit 1;
  fi;
fi

echo;
echo "Package test complete";
echo;
