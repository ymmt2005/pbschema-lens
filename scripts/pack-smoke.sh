#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

npm run build
tarball="$(npm pack --silent)"
smoke="$(mktemp -d)"
trap 'rm -rf "$smoke" "$root/$tarball"' EXIT

npm install --prefix "$smoke" "$root/$tarball"
"$smoke/node_modules/.bin/pbschema-lens" --version
"$smoke/node_modules/.bin/pbschema-lens" build "$root/examples/acme" --out "$smoke/docs"
test -f "$smoke/docs/index.html"
test -f "$smoke/docs/reference/messages/acme.experiment.v1.Flag/index.html"
echo "pack smoke ok: $tarball"
