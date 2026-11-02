#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/var/www/blizhniy}"
APP_NAME="${APP_NAME:-blizhniy}"
PORT="${PORT:-3000}"
EXPECTED_SHA="${COMMIT_SHA:-${1:-}}"
RELEASES_DIR="${RELEASES_DIR:-$(dirname "$APP_DIR")/blizhniy-releases}"
# Resolve physically before APP_DIR changes: an old release may lack this helper.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
ROLLBACK_CHECK="${SCRIPT_DIR}/check-rollback-readiness.mjs"

if [[ ! "$EXPECTED_SHA" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "[rollback] expected a full 40-character commit SHA" >&2
  exit 2
fi

if [[ ! -L "$APP_DIR" ]]; then
  echo "[rollback] application path is not a managed release symlink" >&2
  exit 2
fi

CURRENT_RELEASE="$(readlink -f "$APP_DIR")"
RELEASES_DIR="$(readlink -f "$RELEASES_DIR")"
if [[ "$CURRENT_RELEASE" != "$RELEASES_DIR/"* || "${CURRENT_RELEASE##*/}" != *-"${EXPECTED_SHA:0:12}" ]]; then
  echo "[rollback] active release is no longer the failed commit; refusing rollback" >&2
  exit 3
fi

MARKER="${CURRENT_RELEASE}/.previous-release"
if [[ ! -f "$MARKER" ]]; then
  echo "[rollback] previous release marker is missing" >&2
  exit 4
fi

PREVIOUS_RELEASE="$(cat "$MARKER")"
if [[ ! -d "$PREVIOUS_RELEASE" || ! -f "${PREVIOUS_RELEASE}/ecosystem.config.cjs" ]]; then
  echo "[rollback] previous release is not available" >&2
  exit 4
fi
if [[ ! -f "$ROLLBACK_CHECK" || -L "$ROLLBACK_CHECK" ]] || ! PREVIOUS_BUILD_ID="$(node "$ROLLBACK_CHECK" --build-id "$PREVIOUS_RELEASE")"; then
  echo "[rollback] previous build cannot be verified; process unchanged" >&2
  exit 4
fi

echo "[rollback] restoring previous release"
ln -sfn "$PREVIOUS_RELEASE" "${APP_DIR}.next"
mv -Tf "${APP_DIR}.next" "$APP_DIR"
pm2 delete "$APP_NAME" || true
mkdir -p "${PREVIOUS_RELEASE}/.pm2"
pm2 start "${PREVIOUS_RELEASE}/ecosystem.config.cjs" --update-env </dev/null

if ! node "$ROLLBACK_CHECK" --probe "$PORT" "$PREVIOUS_BUILD_ID"; then
  echo "[rollback] previous release started but readiness failed; intervention required" >&2
  exit 5
fi
if [[ "$(readlink -f "$APP_DIR")" != "$PREVIOUS_RELEASE" ]]; then
  echo "[rollback] release changed during verification; refusing to save state" >&2
  exit 5
fi
pm2 save </dev/null
echo "[rollback] previous release is healthy"
