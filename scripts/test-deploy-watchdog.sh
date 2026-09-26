#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SHA="1111111111111111111111111111111111111111"
TMPDIR_TEST="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_TEST"' EXIT
mkdir -p "$TMPDIR_TEST/releases" "$TMPDIR_TEST/bin"
cat > "$TMPDIR_TEST/bin/pm2" <<'SH'
#!/usr/bin/env bash
exit 0
SH
cat > "$TMPDIR_TEST/bin/curl" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$TMPDIR_TEST/bin/pm2" "$TMPDIR_TEST/bin/curl"
export PATH="$TMPDIR_TEST/bin:$PATH"

prepare() {
  local case_name="$1"
  CASE_DIR="$TMPDIR_TEST/$case_name"
  PREVIOUS="$CASE_DIR/releases/previous"
  CURRENT="$CASE_DIR/releases/new-${SHA:0:12}"
  mkdir -p "$PREVIOUS" "$CURRENT/scripts"
  touch "$PREVIOUS/ecosystem.config.cjs"
  cp "$SCRIPT_DIR/rollback-release.sh" "$CURRENT/scripts/rollback-release.sh"
  printf '%s\n' "$PREVIOUS" > "$CURRENT/.previous-release"
  ln -s "$PREVIOUS" "$CASE_DIR/app"
  cat > "$CASE_DIR/switch.sh" <<SH
#!/usr/bin/env bash
set -eu
ln -sfn '$CURRENT' '$CASE_DIR/app.next'
mv -Tf '$CASE_DIR/app.next' '$CASE_DIR/app'
SH
  export APP_DIR="$CASE_DIR/app" RELEASES_DIR="$CASE_DIR/releases"
  export REMOTE_SCRIPT="$CASE_DIR/switch.sh"
  export REMOTE_STATUS="$CASE_DIR/status" REMOTE_RESULT="$CASE_DIR/result"
  export REMOTE_CONFIRMED="$CASE_DIR/confirmed" REMOTE_ABORT="$CASE_DIR/abort"
  export RELEASE_LOCK_FILE="$CASE_DIR/release.lock" COMMIT_SHA="$SHA"
  export ACK_TIMEOUT_SECONDS=2 POLL_INTERVAL_SECONDS=0.05 LOCK_WAIT_SECONDS=0
}

wait_status() {
  local n
  for n in $(seq 1 100); do
    [[ -f "$REMOTE_STATUS" ]] && return 0
    sleep 0.05
  done
  echo 'remote deploy did not publish a status' >&2
  return 1
}

prepare success
bash "$SCRIPT_DIR/deploy-watchdog.sh" & worker=$!
wait_status
touch "$REMOTE_CONFIRMED"
wait "$worker"
[[ $(cat "$REMOTE_RESULT") == confirmed ]]
[[ $(readlink -f "$APP_DIR") == "$CURRENT" ]]
echo 'success acknowledgement: passed'

prepare failed_postcheck
bash "$SCRIPT_DIR/deploy-watchdog.sh" & worker=$!
wait_status
touch "$REMOTE_ABORT"
wait "$worker"
[[ $(cat "$REMOTE_RESULT") == rolled_back ]]
[[ $(readlink -f "$APP_DIR") == "$PREVIOUS" ]]
echo 'failed postcheck rollback: passed'

prepare lost_ssh
ACK_TIMEOUT_SECONDS=1 bash "$SCRIPT_DIR/deploy-watchdog.sh" & worker=$!
wait "$worker"
[[ $(cat "$REMOTE_RESULT") == rolled_back ]]
[[ $(readlink -f "$APP_DIR") == "$PREVIOUS" ]]
echo 'missing acknowledgement timeout: passed'

prepare competing_run
bash "$SCRIPT_DIR/deploy-watchdog.sh" & worker=$!
wait_status
REMOTE_STATUS="$CASE_DIR/second.status" REMOTE_RESULT="$CASE_DIR/second.result" bash "$SCRIPT_DIR/deploy-watchdog.sh" && exit 1 || second_status=$?
[[ $second_status -eq 75 ]]
[[ $(cat "$CASE_DIR/second.result") == lock_busy ]]
touch "$REMOTE_CONFIRMED"
wait "$worker"
[[ $(cat "$REMOTE_RESULT") == confirmed ]]
echo 'remote release lock: passed'
