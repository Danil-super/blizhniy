#!/usr/bin/env bash
set -Eeuo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/scripts" "$fixture/supabase/maintenance" "$fixture/bin"
cp "$repo_dir/scripts/reconcile-expired-publications.sh" "$fixture/scripts/"
cp "$repo_dir/supabase/maintenance/reconcile-expired-publications.sql" "$fixture/supabase/maintenance/"
: > "$fixture/service.conf"
: > "$fixture/pgpass"
chmod 600 "$fixture/pgpass"

cat > "$fixture/bin/psql" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$MOCK_ARGS_FILE"
exit "${MOCK_EXIT:-0}"
MOCK
chmod +x "$fixture/bin/psql"

run_fixture() {
  PGSERVICEFILE="$fixture/service.conf" \
  PGPASSFILE="$fixture/pgpass" \
  MOCK_ARGS_FILE="$fixture/args" \
  PATH="$fixture/bin:$PATH" \
  bash "$fixture/scripts/reconcile-expired-publications.sh"
}

run_fixture > "$fixture/stdout"
args="$(cat "$fixture/args")"
[[ "$args" == *"--single-transaction"* ]]
[[ "$args" == *"ON_ERROR_STOP=1"* ]]
[[ "$args" == *"service=blizhniy_expiry"* ]]
[[ "$args" == *"reconcile-expired-publications.sql"* ]]
[[ "$(cat "$fixture/stdout")" == *"reconciliation completed"* ]]

if MOCK_EXIT=17 run_fixture > "$fixture/stdout" 2> "$fixture/stderr"; then
  echo "psql failure was hidden" >&2
  exit 1
else
  result=$?
  [[ "$result" -eq 17 ]]
fi

chmod 644 "$fixture/pgpass"
if run_fixture > "$fixture/stdout" 2> "$fixture/stderr"; then
  echo "unsafe pgpass permissions were accepted" >&2
  exit 1
fi
[[ "$(cat "$fixture/stderr")" == *"must not be readable"* ]]
chmod 600 "$fixture/pgpass"

rm "$fixture/supabase/maintenance/reconcile-expired-publications.sql"
if run_fixture > "$fixture/stdout" 2> "$fixture/stderr"; then
  echo "missing SQL was accepted" >&2
  exit 1
fi
[[ "$(cat "$fixture/stderr")" == *"missing from the deployed release"* ]]

echo "Expiry runner tests passed"
