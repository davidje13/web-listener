#!/bin/sh
set -e

echo "Building...";
echo;

BASE_DIR="$(cd "$(dirname "$0")/.."; pwd)";
rm "$BASE_DIR/package.tgz" 2>/dev/null || true;
rm -rf "$BASE_DIR/build" 2>/dev/null || true;

cd "$BASE_DIR";
npx rollup --config rollup.config.mjs;
cd - >/dev/null;

rm -rf "$BASE_DIR/build/types";
cp "$BASE_DIR/README.md" "$BASE_DIR/LICENSE" "$BASE_DIR/build";
node \
  -e 'const j=JSON.parse(process.argv[1]);for(const k of ["private","devDependencies","scripts"])delete j[k];process.stdout.write(JSON.stringify(j,null,"\t")+"\n");' \
  "$(cat "$BASE_DIR/package.json")" \
  > "$BASE_DIR/build/package.json";
node \
  -e 'process.stdout.write(JSON.stringify(JSON.parse(process.argv[1]))+"\n");' \
  "$(cat "$BASE_DIR/src/bin/config/schema.json")" \
  > "$BASE_DIR/build/schema.json";

cd "$BASE_DIR/build";
npm pack;
cd - >/dev/null;

mv "$BASE_DIR/build/web-listener-"*.tgz "$BASE_DIR/package.tgz";
rm -rf "$BASE_DIR/build";

echo;
echo "Build complete";
echo;
