#!/usr/bin/env bash
# Copy exercise images (JPG) and animations (GIF) from a local source into ./media.
# Usage: scripts/fetch-media.sh <exercise-source-dir>
set -euo pipefail
cd "$(dirname "$0")/.."
src="${1:-}"
if [[ -z "$src" ]]; then
  echo "Usage: $0 <exercise-source-dir>" >&2
  exit 1
fi
if [[ ! -d "$src/images" || ! -d "$src/videos" ]]; then
  echo "Source directory must contain images/ and videos/" >&2
  exit 1
fi
mkdir -p media/img media/gif
cp "$src"/images/*.jpg media/img/
cp "$src"/videos/*.gif media/gif/
echo "✓ $(ls media/img | wc -l) images, $(ls media/gif | wc -l) GIFs"
