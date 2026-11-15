#!/usr/bin/env bash
# Sets Quick Match settings in .env. See docs/DOCUMENT_QUICK_MATCH.md, section 6.
set -euo pipefail

cd "$(dirname "$0")"
ENV_FILE=.env

usage() {
  echo "Usage: ./mp-config.sh [-d wait_seconds] [-t match_seconds] [-w word_count]" >&2
  exit 1
}

check() {
  [[ $2 =~ ^[1-9][0-9]*$ ]] || { echo "-$1 must be a positive whole number, got '$2'" >&2; exit 1; }
}

set_var() {
  touch "$ENV_FILE"
  grep -v "^$1=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
  echo "$1=$2" >> "$ENV_FILE.tmp"
  cat "$ENV_FILE.tmp" > "$ENV_FILE"
  rm "$ENV_FILE.tmp"
  echo "$1=$2"
}

[[ $# -gt 0 ]] || usage

wait_seconds="" match_seconds="" word_count=""
while getopts "d:t:w:" opt; do
  case $opt in
    d) check d "$OPTARG"; wait_seconds=$OPTARG ;;
    t) check t "$OPTARG"; match_seconds=$OPTARG ;;
    w) check w "$OPTARG"; word_count=$OPTARG ;;
    *) usage ;;
  esac
done
shift $((OPTIND - 1))
[[ $# -eq 0 ]] || usage

[[ -z $wait_seconds ]] || set_var QUICK_MATCH_WAIT_SECONDS "$wait_seconds"
[[ -z $match_seconds ]] || set_var MATCH_DURATION_SECONDS "$match_seconds"
[[ -z $word_count ]] || set_var WORD_COUNT "$word_count"

echo "Saved to $ENV_FILE. Applying..."
docker compose up -d
