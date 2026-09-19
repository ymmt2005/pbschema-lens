#!/usr/bin/env bash
# True when HEAD changed package.json's version to a new x.y.z that has no Release yet.
set -euo pipefail

emit() {
  echo "$1=$2"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "$1=$2" >> "$GITHUB_OUTPUT"
  fi
}

version="$(node -p "require('./package.json').version")"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Skip: package.json version is not x.y.z ($version)"
  emit release false
  emit version "$version"
  exit 0
fi

if git rev-parse --verify --quiet HEAD^ >/dev/null; then
  prev="$(git show HEAD^:package.json | node -e '
    let s = "";
    process.stdin.on("data", (chunk) => { s += chunk; });
    process.stdin.on("end", () => { process.stdout.write(JSON.parse(s).version); });
  ')"
  if [[ "$prev" == "$version" ]]; then
    echo "Skip: package.json version unchanged ($version)"
    emit release false
    emit version "$version"
    exit 0
  fi
  echo "Version bump $prev -> $version"
else
  echo "No parent commit; treating $version as a version bump."
fi

if [[ -n "${GH_TOKEN:-}" ]] && gh release view "v${version}" >/dev/null 2>&1; then
  echo "Skip: GitHub Release v${version} already exists"
  emit release false
  emit version "$version"
  exit 0
fi

emit release true
emit version "$version"
