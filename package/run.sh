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
npm test;
cd - >/dev/null;

echo;
echo "Package test complete";
echo;
