#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Hugo Dev Server"
echo "==============="

if ! command -v hugo &>/dev/null; then
  echo "ERROR: Hugo is not installed."
  exit 1
fi

echo "Hugo version: $(hugo version)"
echo "Starting server at: http://localhost:1313"
echo "Press Ctrl+C to stop."
echo ""

cd "$SCRIPT_DIR" && hugo server \
  --buildDrafts \
  --buildFuture \
  --disableFastRender \
  --bind 0.0.0.0 \
  --port 1313
