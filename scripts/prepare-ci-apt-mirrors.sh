#!/usr/bin/env bash
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-}" != true || "${RUNNER_OS:-}" != Linux || "${RUNNER_ARCH:-}" != X64 || "${RUNNER_ENVIRONMENT:-}" != github-hosted ]]; then
  echo "APT mirror preparation requires a GitHub-hosted Linux x64 runner." >&2
  exit 1
fi

mirror_list=/etc/apt/apt-mirrors.txt
test -f "$mirror_list"
# Keep signed Ubuntu repositories and avoid the failing Azure mirror on ephemeral runners.
printf '%s\tpriority:%s\n' 'https://archive.ubuntu.com/ubuntu/' 1 'https://security.ubuntu.com/ubuntu/' 2 | sudo tee "$mirror_list" >/dev/null
