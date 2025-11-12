#!/bin/sh
set -e

SELF_DIR="$(dirname "$0")";

npm --prefix "$SELF_DIR" -s install --audit=false;

echo "Running performance test...";
echo;
"$SELF_DIR/URLEncoded.test.mts";
"$SELF_DIR/Multipart.test.mts";
"$SELF_DIR/StreamSearch.test.mts";
echo;
echo "Performance test complete";
echo;
