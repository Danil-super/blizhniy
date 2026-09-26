#!/usr/bin/env bash
set -euo pipefail

report_dir="${ZAP_REPORT_DIR:-.}"
for report in zap-report.html zap-report.json zap-report.md; do
  if [[ ! -s "$report_dir/$report" ]]; then
    echo "ZAP did not produce a nonempty $report" >&2
    exit 1
  fi
done

case "${1:-}" in
  0) echo 'ZAP baseline completed without findings.' ;;
  1) echo 'ZAP reported at least one FAIL finding.' >&2; exit 1 ;;
  2) echo 'ZAP reported WARN findings; review and resolve or explicitly triage them.' >&2; exit 1 ;;
  3) echo 'ZAP scan failed to complete.' >&2; exit 1 ;;
  *) echo 'ZAP returned no result or an unknown exit code.' >&2; exit 1 ;;
esac
