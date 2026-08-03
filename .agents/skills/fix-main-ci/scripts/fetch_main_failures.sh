#!/usr/bin/env bash
# Fetch failing test jobs from the latest N main-branch CI runs.
#
# Usage:
#   fetch_main_failures.sh [--count N] [--workflow CI] [--out-dir DIR]
#
# Prints a per-commit matrix showing which test jobs failed on each of the last
# N commits on main. Makes it obvious whether a failure is consistent (flaky
# candidate or broken main) vs a one-off regression from the latest commit.
# Writes per-job failure logs for the latest commit to $OUT_DIR.
#
# Works on bash 3.2+ (macOS default) — no associative arrays.

set -euo pipefail

COUNT=5
WORKFLOW="CI"
TEST_JOBS=("test" "e2e-core" "e2e-perf" "e2e-external")
OUT_DIR=".context/fix-main-ci"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --count) COUNT="$2"; shift 2 ;;
    --workflow) WORKFLOW="$2"; shift 2 ;;
    --out-dir) OUT_DIR="$2"; shift 2 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

command -v gh >/dev/null || { echo "gh CLI is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

mkdir -p "$OUT_DIR"

echo "Fetching last $COUNT completed '$WORKFLOW' runs on main..." >&2
RUNS_JSON="$(gh run list \
  --workflow "$WORKFLOW" \
  --branch main \
  --event push \
  --status completed \
  --limit "$COUNT" \
  --json databaseId,headSha,displayTitle,conclusion,createdAt,url)"

echo "$RUNS_JSON" | jq -r '.[] | "\(.databaseId)\t\(.headSha[0:7])\t\(.conclusion)\t\(.displayTitle)"' >&2
echo "" >&2

# Flat key-value lookups (bash 3.2 compatible): each "$key=$value" is one line
# of $KV. Read back with kv_get below.
KV=""
COMMITS=()
LATEST_SHA=""

kv_set() { KV+=$(printf '%s=%s\n' "$1" "$2")$'\n'; }
kv_get() { printf '%s' "$KV" | awk -F= -v k="$1" '$1==k { sub(/^[^=]+=/, ""); print; exit }'; }

while IFS=$'\t' read -r run_id sha conclusion title; do
  COMMITS+=("$sha")
  kv_set "RUN_ID_OF:$sha" "$run_id"
  kv_set "RUN_URL_OF:$sha" "$(echo "$RUNS_JSON" | jq -r ".[] | select(.databaseId==$run_id) | .url")"
  [[ -z "$LATEST_SHA" ]] && LATEST_SHA="$sha"

  jobs_json="$(gh run view "$run_id" --json jobs)"
  for job in "${TEST_JOBS[@]}"; do
    job_conclusion="$(echo "$jobs_json" | jq -r --arg n "$job" \
      '.jobs[] | select(.name == $n) | .conclusion' | head -1)"
    [[ -z "$job_conclusion" ]] && job_conclusion="missing"
    kv_set "MATRIX:$sha,$job" "$job_conclusion"
  done

  if [[ "$sha" == "$LATEST_SHA" ]]; then
    for job in "${TEST_JOBS[@]}"; do
      if [[ "$(kv_get "MATRIX:$sha,$job")" == "failure" ]]; then
        log_file="$OUT_DIR/${sha:0:7}_${job}.log"
        echo "Downloading failed-log for $job @ ${sha:0:7} -> $log_file" >&2
        job_id="$(echo "$jobs_json" | jq -r --arg n "$job" \
          '.jobs[] | select(.name==$n) | .databaseId' | head -1)"
        gh run view "$run_id" --log-failed --job "$job_id" > "$log_file" 2>/dev/null \
          || echo "(no failed-log output)" > "$log_file"
      fi
    done
  fi
done < <(echo "$RUNS_JSON" | jq -r '.[] | "\(.databaseId)\t\(.headSha)\t\(.conclusion)\t\(.displayTitle)"')

printf "\n== Test-job conclusion matrix (rows = commits, newest first) ==\n"
printf "%-10s" "commit"
for job in "${TEST_JOBS[@]}"; do printf " | %-14s" "$job"; done
printf "\n"
printf "%s\n" "$(printf '%*s' 80 '' | tr ' ' '-')"

for sha in "${COMMITS[@]}"; do
  printf "%-10s" "${sha:0:7}"
  for job in "${TEST_JOBS[@]}"; do
    printf " | %-14s" "$(kv_get "MATRIX:$sha,$job")"
  done
  printf "\n"
done

echo ""
echo "Latest commit: ${LATEST_SHA:0:7}  $(kv_get "RUN_URL_OF:$LATEST_SHA")"
echo "Failed-job logs written to: $OUT_DIR/"
echo ""
echo "Interpretation:"
echo "  - failure on latest + success on prior commits => regression from latest commit"
echo "  - failure on >=3 of $COUNT recent commits      => likely flaky or main broken"
echo "  - intermittent failure across commits          => classic flaky"
