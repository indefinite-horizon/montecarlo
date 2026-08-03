#!/usr/bin/env bash
# Extract failing test names / files from a downloaded GHA log file.
#
# Usage: extract_failing_tests.sh <log-file>
#
# Tries known patterns: Vitest (" FAIL ", "×"), Playwright numbered-failure
# lists and the terminal "N failed" block, plus surrounding error context.

set -euo pipefail
[[ $# -ge 1 ]] || { echo "usage: $0 <log-file>" >&2; exit 2; }
command -v rg >/dev/null || {
  echo "rg (ripgrep) is required — install via: brew install ripgrep" >&2
  exit 1
}
LOG="$1"

echo "== Vitest FAIL lines =="
rg -n --color=never '^[^│]*(FAIL|❯|× )' "$LOG" | head -50 || true

echo ""
echo "== Playwright failed tests =="
# Playwright emits failing tests in two places:
#   1. Numbered list:  "  1) [project] › path/to/spec.ts:LINE:COL › Test name"
#   2. Terminal block: "  N failed" followed by one "[project] › ..." line per test
# Extract just the "[project] › spec.ts:LINE:COL › ..." slice so the two
# sources collapse into one unique list per failing test.
rg -o --color=never '\[[a-z0-9_-]+\][^\[]*\.spec\.(ts|js):\d+:\d+[^[:cntrl:]]*' "$LOG" \
  | awk '!seen[$0]++' \
  | head -50 \
  || true

echo ""
echo "== Error / expected vs received =="
rg -n --color=never -A2 '(Error:|expected|Received|AssertionError)' "$LOG" | head -80 || true

echo ""
echo "== Summary lines =="
rg -n --color=never '(Test Files|Tests|passed|failed|flaky)\s*\d' "$LOG" | head -20 || true
