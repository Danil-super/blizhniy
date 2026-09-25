#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/var/www/blizhniy}"
APP_NAME="${APP_NAME:-blizhniy}"
PORT="${PORT:-3000}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${PORT}/api/health}"
EXPECTED_SHA="${COMMIT_SHA:-${1:-}}"
RELEASES_DIR="${RELEASES_DIR:-$(dirname "$APP_DIR")/blizhniy-releases}"

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

echo "[rollback] restoring previous release"
ln -sfn "$PREVIOUS_RELEASE" "${APP_DIR}.next"
mv -Tf "${APP_DIR}.next" "$APP_DIR"
pm2 delete "$APP_NAME" || true
mkdir -p "${PREVIOUS_RELEASE}/.pm2"
pm2 start "${PREVIOUS_RELEASE}/ecosystem.config.cjs" --update-env </dev/null

for attempt in $(seq 1 30); do
  if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null; then
    pm2 save </dev/null
    echo "[rollback] previous release is healthy"
    exit 0
  fi
  sleep 2
done

echo "[rollback] previous release restored but healthcheck failed" >&2
exit 5
