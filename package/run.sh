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

gzip -dc "$BASE_DIR/package/node_modules/web-listener/man1/web-listener.1.gz" | mandoc -T lint -W style;

echo;
echo "Package test complete";
echo;
