#!/usr/bin/env bash
# build.sh — produce dist/live-factcheck-sidebar-${VERSION}.zip
#
# Reads the version from chrome-extension/manifest.json and packages the
# extension for distribution. EXCLUDES the *.original.* diff-reference
# backups (they were ~36% of the v0.5.0 zip — dev-only artifacts).
#
# Usage:
#   ./scripts/build.sh                 # build the zip
#   ./scripts/build.sh --keep-staging  # leave /tmp staging dir behind for inspection
#
# Convention: build in /tmp then copy to dist/ — atomic-rename can fail on
# some network filesystems (was an iCloud Drive issue in the prior project
# location; no longer applies but the pattern is harmless here).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(grep -E '"version"' "$ROOT/chrome-extension/manifest.json" | sed -E 's/.*"version": *"([^"]+)".*/\1/')"
if [[ -z "$VERSION" ]]; then
  echo "build.sh: could not parse version from manifest.json" >&2
  exit 1
fi

ZIP_NAME="live-factcheck-sidebar-${VERSION}.zip"
STAGING="$(mktemp -d -t lfcs-build.XXXXXX)"
DEST="$ROOT/dist/$ZIP_NAME"

echo "build.sh: packaging v${VERSION} -> dist/${ZIP_NAME}"
echo "build.sh: staging dir = $STAGING"

# Copy chrome-extension/ excluding the *.original.* dev-reference backups
# AND any .DS_Store cruft. Note: prompts.original.js is the pre-YouTube-
# rewrite reference and is NOT excluded — that file is load-bearing for
# diff review per CLAUDE.md and shipped in v0.3.0 too.
mkdir -p "$STAGING/chrome-extension"
rsync -a \
  --exclude '.DS_Store' \
  --exclude '*.original.js' \
  --exclude '*.original.html' \
  --exclude '*.original.json' \
  --exclude '*.original.css' \
  --include 'prompts.original.js' \
  "$ROOT/chrome-extension/" "$STAGING/chrome-extension/"

# But re-include prompts.original.js explicitly (rsync --include after --exclude
# is tricky; copy it directly to be sure).
if [[ -f "$ROOT/chrome-extension/prompts.original.js" ]]; then
  cp "$ROOT/chrome-extension/prompts.original.js" "$STAGING/chrome-extension/"
fi

# Build the zip in /tmp, then cat it to dist/ — see header comment for why.
( cd "$STAGING" && zip -rq "/tmp/${ZIP_NAME}" chrome-extension )
mkdir -p "$ROOT/dist"
cat "/tmp/${ZIP_NAME}" > "$DEST"
rm -f "/tmp/${ZIP_NAME}"

# Show what landed in the zip so a reviewer can sanity-check the contents.
echo "build.sh: zip contents:"
unzip -l "$DEST"
SIZE="$(du -h "$DEST" | cut -f1)"
echo "build.sh: ${ZIP_NAME} = ${SIZE}"

if [[ "${1:-}" != "--keep-staging" ]]; then
  rm -rf "$STAGING"
else
  echo "build.sh: staging preserved at $STAGING"
fi
