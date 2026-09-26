#!/usr/bin/env bash
set -u

APP_DIR="${APP_DIR:-/var/www/blizhniy}"
LOCK_FILE="${RELEASE_LOCK_FILE:-$(dirname "$APP_DIR")/.blizhniy-release.lock}"
ACK_TIMEOUT_SECONDS="${ACK_TIMEOUT_SECONDS:-1800}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-10}"
LOCK_WAIT_SECONDS="${LOCK_WAIT_SECONDS:-120}"

: "${REMOTE_SCRIPT:?}"
: "${REMOTE_STATUS:?}"
: "${REMOTE_RESULT:?}"
: "${REMOTE_CONFIRMED:?}"
: "${REMOTE_ABORT:?}"
: "${COMMIT_SHA:?}"

# The runner can outlive the Actions SSH connection. Keep the host lock until
# post-deploy checks explicitly confirm the release or it has been rolled back.
exec 9>"$LOCK_FILE"
if ! flock -w "$LOCK_WAIT_SECONDS" 9; then
  printf '75\n' > "$REMOTE_STATUS"
  printf 'lock_busy\n' > "$REMOTE_RESULT"
  exit 75
fi

if bash "$REMOTE_SCRIPT"; then
  deploy_status=0
else
  deploy_status=$?
fi
printf '%s\n' "$deploy_status" > "$REMOTE_STATUS"
if (( deploy_status != 0 )); then
  # A connection or wrapper error could be reported after the new symlink was
  # promoted. Reconcile the active SHA before accepting a failed deploy.
  if [[ -L "$APP_DIR" && "$(readlink -f "$APP_DIR")" == *-"${COMMIT_SHA:0:12}" ]]; then
    if APP_DIR="$APP_DIR" COMMIT_SHA="$COMMIT_SHA" bash "$APP_DIR/scripts/rollback-release.sh"; then
      printf 'rolled_back\n' > "$REMOTE_RESULT"
      exit "$deploy_status"
    fi
    printf 'rollback_failed\n' > "$REMOTE_RESULT"
    exit 1
  fi
  printf 'deploy_failed\n' > "$REMOTE_RESULT"
  exit "$deploy_status"
fi

# A red/aborted Actions job may never manage to reconnect. If it does not
# confirm the release within the lease, revert only the matching commit SHA.
deadline=$(( $(date +%s) + ACK_TIMEOUT_SECONDS ))
while (( $(date +%s) < deadline )); do
  if [[ -f "$REMOTE_ABORT" ]]; then
    break
  fi
  if [[ -f "$REMOTE_CONFIRMED" ]]; then
    printf 'confirmed\n' > "$REMOTE_RESULT"
    exit 0
  fi
  sleep "$POLL_INTERVAL_SECONDS"
done

if APP_DIR="$APP_DIR" COMMIT_SHA="$COMMIT_SHA" bash "$APP_DIR/scripts/rollback-release.sh"; then
  printf 'rolled_back\n' > "$REMOTE_RESULT"
  exit 0
fi
printf 'rollback_failed\n' > "$REMOTE_RESULT"
exit 1
