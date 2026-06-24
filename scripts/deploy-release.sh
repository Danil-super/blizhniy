#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/var/www/blizhniy}"
REPO_URL="${REPO_URL:-https://github.com/Danil-super/blizhniy.git}"
BRANCH="${BRANCH:-main}"
COMMIT_SHA="${COMMIT_SHA:-}"
SOURCE_ARCHIVE="${SOURCE_ARCHIVE:-}"
SOURCE_DIR="${SOURCE_DIR:-}"
APP_NAME="${APP_NAME:-blizhniy}"
PORT="${PORT:-3000}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${PORT}/api/health}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

BASE_DIR="$(dirname "$APP_DIR")"
RELEASES_DIR="${RELEASES_DIR:-${BASE_DIR}/blizhniy-releases}"
TIMESTAMP="$(date -u +%Y%m%d%H%M%S)"
LEGACY_DIR="${APP_DIR}.legacy-${TIMESTAMP}"
SHORT_SHA="${COMMIT_SHA:0:12}"

if [[ -z "$SHORT_SHA" ]]; then
  SHORT_SHA="$TIMESTAMP"
fi

RELEASE_DIR="${RELEASES_DIR}/${TIMESTAMP}-${SHORT_SHA}"
PREVIOUS_RELEASE=""

log() {
  printf '[deploy] %s\n' "$*"
}

current_release() {
  if [[ -L "$APP_DIR" ]]; then
    readlink -f "$APP_DIR"
  elif [[ -d "$APP_DIR" ]]; then
    printf '%s\n' "$APP_DIR"
  fi
}

copy_env_files() {
  local source_dir="$1"

  [[ -d "$source_dir" ]] || return 0

  for env_file in .env .env.local .env.production .env.production.local; do
    if [[ -f "${source_dir}/${env_file}" ]]; then
      cp "${source_dir}/${env_file}" "${RELEASE_DIR}/${env_file}"
      chmod 600 "${RELEASE_DIR}/${env_file}" || true
    fi
  done
}

healthcheck() {
  local attempt

  for attempt in $(seq 1 30); do
    if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null; then
      return 0
    fi

    sleep 2
  done

  return 1
}

rollback() {
  if [[ -n "$PREVIOUS_RELEASE" && -d "$PREVIOUS_RELEASE" && -f "${PREVIOUS_RELEASE}/ecosystem.config.cjs" ]]; then
    log "healthcheck failed; rolling back to ${PREVIOUS_RELEASE}"
    ln -sfn "$PREVIOUS_RELEASE" "${APP_DIR}.next"
    mv -Tf "${APP_DIR}.next" "$APP_DIR"
    pm2 delete "$APP_NAME" || true
    pm2 start "${PREVIOUS_RELEASE}/ecosystem.config.cjs" --update-env
    pm2 save
  else
    log "healthcheck failed and no previous release is available"
  fi
}

trap 'log "deploy failed"; rollback' ERR

mkdir -p "$RELEASES_DIR"
PREVIOUS_RELEASE="$(current_release || true)"

if [[ -d "$APP_DIR" && ! -L "$APP_DIR" ]]; then
  log "converting existing app directory to symlink-managed release"
  mv "$APP_DIR" "$LEGACY_DIR"
  ln -sfn "$LEGACY_DIR" "$APP_DIR"
  PREVIOUS_RELEASE="$LEGACY_DIR"
fi

if [[ -n "$SOURCE_ARCHIVE" ]]; then
  log "extracting ${SOURCE_ARCHIVE} into ${RELEASE_DIR}"
  mkdir -p "$RELEASE_DIR"
  tar -xzf "$SOURCE_ARCHIVE" -C "$RELEASE_DIR"
elif [[ -n "$SOURCE_DIR" ]]; then
  log "copying ${SOURCE_DIR} into ${RELEASE_DIR}"
  mkdir -p "$RELEASE_DIR"
  tar -C "$SOURCE_DIR" --exclude .git -cf - . | tar -C "$RELEASE_DIR" -xf -
else
  log "cloning ${BRANCH} into ${RELEASE_DIR}"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$RELEASE_DIR"

  if [[ -n "$COMMIT_SHA" ]]; then
    git -C "$RELEASE_DIR" fetch --depth 1 origin "$COMMIT_SHA"
    git -C "$RELEASE_DIR" checkout --detach "$COMMIT_SHA"
  fi
fi

copy_env_files "$PREVIOUS_RELEASE"

log "installing dependencies"
npm --prefix "$RELEASE_DIR" ci --prefer-online --no-audit --no-fund

log "building release"
npm --prefix "$RELEASE_DIR" run build

log "starting ${APP_NAME} from ${RELEASE_DIR}"
pm2 delete "$APP_NAME" || true
pm2 start "${RELEASE_DIR}/ecosystem.config.cjs" --update-env

log "checking ${HEALTH_URL}"
healthcheck

log "promoting release"
ln -sfn "$RELEASE_DIR" "${APP_DIR}.next"
mv -Tf "${APP_DIR}.next" "$APP_DIR"
pm2 save

log "pruning old releases"
find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' |
  sort -rn |
  awk -v keep="$KEEP_RELEASES" 'NR > keep {print $2}' |
  while read -r old_release; do
    if [[ -n "$old_release" && "$old_release" != "$RELEASE_DIR" && "$old_release" != "$PREVIOUS_RELEASE" ]]; then
      rm -rf "$old_release"
    fi
  done

if [[ -d "${RELEASE_DIR}/.git" ]]; then
  log "deployed $(git -C "$RELEASE_DIR" rev-parse --short HEAD)"
else
  log "deployed ${SHORT_SHA}"
fi
