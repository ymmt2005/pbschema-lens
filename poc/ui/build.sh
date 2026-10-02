#!/usr/bin/env bash
# Compile the proof-of-concept page and copy it next to the Go embed.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
if [[ -x node_modules/.bin/tsc ]]; then
  node_modules/.bin/tsc -p poc/ui/tsconfig.json
else
  npx --yes -p typescript@5.9.3 tsc -p poc/ui/tsconfig.json
fi
mkdir -p poc/internal/site/assets
cp poc/ui/dist/main.js poc/internal/site/assets/app.js
