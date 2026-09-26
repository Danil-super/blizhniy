#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
report_dir="$(mktemp -d)"
trap 'rm -rf "$report_dir"' EXIT
export ZAP_REPORT_DIR="$report_dir"
for file in zap-report.html zap-report.json zap-report.md; do
  printf 'report\n' > "$report_dir/$file"
done
bash "$script_dir/check-zap-result.sh" 0 >/dev/null
for code in 1 2 3 '' 42; do
  if bash "$script_dir/check-zap-result.sh" "$code" >/dev/null 2>&1; then
    echo "Unexpectedly accepted exit code '$code'" >&2
    exit 1
  fi
done
rm "$report_dir/zap-report.json"
if bash "$script_dir/check-zap-result.sh" 0 >/dev/null 2>&1; then
  echo 'Unexpectedly accepted a missing JSON report' >&2
  exit 1
fi
echo 'ZAP exit code and missing artifact checks passed.'
