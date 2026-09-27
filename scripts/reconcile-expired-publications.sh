#!/usr/bin/env bash
set -Eeuo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
sql_file="${repo_dir}/supabase/maintenance/reconcile-expired-publications.sql"

die() {
  printf '[expiry] %s\n' "$*" >&2
  exit 2
}

[[ -f "$sql_file" ]] || die "Maintenance SQL is missing from the deployed release"
[[ -n "${PGSERVICEFILE:-}" && -r "$PGSERVICEFILE" ]] || die "PGSERVICEFILE is missing or unreadable"
[[ -n "${PGPASSFILE:-}" && -r "$PGPASSFILE" ]] || die "PGPASSFILE is missing or unreadable"
[[ -z "${PGPASSWORD:-}" ]] || die "Use PGPASSFILE rather than PGPASSWORD"
command -v psql >/dev/null 2>&1 || die "psql is not installed"

pass_mode="$(stat -c %a -- "$PGPASSFILE")"
(( (8#$pass_mode & 077) == 0 )) || die "PGPASSFILE must not be readable by group or others"
[[ "$(stat -c %u -- "$PGPASSFILE")" == "$(id -u)" ]] || die "PGPASSFILE must belong to the runner user"

# No HTTP route or shared API key is involved. The database login can be
# restricted to SELECT and UPDATE(status) on listings and vacancies.
printf '[expiry] reconciling publication statuses\n'
psql -X -w --set=ON_ERROR_STOP=1 --single-transaction \
  --dbname='service=blizhniy_expiry' \
  --file="$sql_file"
printf '[expiry] reconciliation completed\n'
