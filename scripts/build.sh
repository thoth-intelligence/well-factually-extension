#!/usr/bin/env bash
# build.sh — produce dist/well-factually-${VERSION}.zip from minified bundle.
#
# v0.7.0 reshape: the zip now ships the esbuild-bundled output from
# build/chrome-extension/, NOT the raw source in chrome-extension/. The
# unminified source still loads fine via `Load unpacked` against
# chrome-extension/ for development.
#
# Usage:
#   ./scripts/build.sh                    # bundle, then zip
#   ./scripts/build.sh --no-bundle        # skip esbuild, zip raw source
#                                          (useful for diffing/audit)
#   ./scripts/build.sh --keep-staging     # leave /tmp staging behind
#
# Convention: stage in /tmp, then `cat` the zip into dist/ — atomic-
# rename can fail on some network filesystems (was an iCloud Drive issue
# in the prior project location; no longer applies but pattern is fine).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(grep -E '"version"' "$ROOT/chrome-extension/manifest.json" | sed -E 's/.*"version": *"([^"]+)".*/\1/')"
if [[ -z "$VERSION" ]]; then
  echo "build.sh: could not parse version from manifest.json" >&2
  exit 1
fi

# Source dir for the zip: bundled output by default, raw source if
# --no-bundle was passed.
BUNDLE=1
KEEP_STAGING=0
for arg in "$@"; do
  case "$arg" in
    --no-bundle) BUNDLE=0 ;;
    --keep-staging) KEEP_STAGING=1 ;;
  esac
done

if [[ $BUNDLE -eq 1 ]]; then
  echo "build.sh: bundling via esbuild…"
  ( cd "$ROOT" && node scripts/esbuild.js )
  SRC_DIR="$ROOT/build/chrome-extension"
else
  echo "build.sh: skipping bundle (--no-bundle). Zipping raw source."
  SRC_DIR="$ROOT/chrome-extension"
fi

ZIP_NAME="well-factually-${VERSION}.zip"
STAGING="$(mktemp -d -t wf-build.XXXXXX)"
DEST="$ROOT/dist/$ZIP_NAME"

echo "build.sh: packaging v${VERSION} -> dist/${ZIP_NAME}"
echo "build.sh: staging dir = $STAGING"

# Copy the chosen source into staging. When zipping raw source (audit
# mode), exclude the *.original.* dev-reference backups — they were ~36%
# of the v0.5.0 zip. The bundled path doesn't have them.
mkdir -p "$STAGING/chrome-extension"
if [[ $BUNDLE -eq 1 ]]; then
  rsync -a --exclude '.DS_Store' "$SRC_DIR/" "$STAGING/chrome-extension/"
else
  rsync -a \
    --exclude '.DS_Store' \
    --exclude '*.original.js' \
    --exclude '*.original.html' \
    --exclude '*.original.json' \
    --exclude '*.original.css' \
    "$SRC_DIR/" "$STAGING/chrome-extension/"
  # Preserve prompts.original.js — load-bearing per CLAUDE.md.
  if [[ -f "$ROOT/chrome-extension/prompts.original.js" ]]; then
    cp "$ROOT/chrome-extension/prompts.original.js" "$STAGING/chrome-extension/"
  fi
fi

# Build the zip in /tmp, then cat it to dist/ — see header for why.
( cd "$STAGING" && zip -rq "/tmp/${ZIP_NAME}" chrome-extension )
mkdir -p "$ROOT/dist"
cat "/tmp/${ZIP_NAME}" > "$DEST"
rm -f "/tmp/${ZIP_NAME}"

# Show what landed in the zip so a reviewer can sanity-check the contents.
echo "build.sh: zip contents:"
unzip -l "$DEST"
SIZE="$(du -h "$DEST" | cut -f1)"
echo "build.sh: ${ZIP_NAME} = ${SIZE}"

if [[ $KEEP_STAGING -eq 0 ]]; then
  rm -rf "$STAGING"
else
  echo "build.sh: staging preserved at $STAGING"
fi
