#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

[[ $# -eq 3 || $# -eq 4 ]] || fail 'Usage: setup-deployment-ssh.sh HOST PORT TRUST_DIRECTORY [VERIFIED_PUBLIC_KEY_FILE]'
vps_host=$1
vps_port=$2
trust_directory=$3
script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
public_key_file=${4:-"$script_directory/../deploy/vps-host-key.pub"}

# These values also become SSH/SCP destinations. Reject options, whitespace,
# patterns and known_hosts separators before creating files or sending keys.
[[ ${#vps_host} -le 253 && "$vps_host" =~ ^[[:alnum:]]([[:alnum:].-]*[[:alnum:]])?$ ]] || fail 'Invalid VPS_HOST; expected an IPv4 address or DNS hostname'
IFS='.' read -r -a host_labels <<< "$vps_host"
for label in "${host_labels[@]}"; do
  [[ ${#label} -le 63 && "$label" =~ ^[[:alnum:]]([[:alnum:]-]*[[:alnum:]])?$ ]] || fail 'Invalid VPS_HOST label'
done
[[ "$vps_port" =~ ^[1-9][0-9]{0,4}$ && "$vps_port" -le 65535 ]] || fail 'Invalid VPS_PORT; expected an integer from 1 to 65535'
[[ "${VPS_USER:-}" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]] || fail 'Invalid VPS_USER'
# RUNNER_TEMP is runner-controlled, not repository input. A narrow path shape
# prevents SSH config substitutions/directives and rejects the root directory.
[[ "$trust_directory" =~ ^/[a-zA-Z0-9_./-]+$ && "$trust_directory" != / && ! -L "$trust_directory" ]] || fail 'Invalid SSH trust directory'
[[ -f "$public_key_file" ]] || fail 'Verified SSH public key file is missing'
mapfile -t public_key_lines < "$public_key_file"
[[ ${#public_key_lines[@]} -eq 1 && "${public_key_lines[0]}" =~ ^ssh-ed25519\ [a-zA-Z0-9+/=]+$ ]] || fail 'Expected exactly one verified ED25519 public host key'
ssh-keygen -l -f "$public_key_file" >/dev/null 2>&1 || fail 'Verified SSH public key is malformed'

for name in known_hosts ssh_config deploy_key; do
  [[ ! -L "$trust_directory/$name" ]] || fail 'Refusing a symlink in SSH trust directory'
done
umask 077
mkdir -p -- "$trust_directory"
chmod 700 -- "$trust_directory"
lookup_host=$vps_host
if [[ "$vps_port" != 22 ]]; then
  lookup_host="[$vps_host]:$vps_port"
fi
printf '%s %s\n' "$lookup_host" "${public_key_lines[0]}" > "$trust_directory/known_hosts"
chmod 600 -- "$trust_directory/known_hosts"

printf '%s\n' \
  'Host *' \
  '  StrictHostKeyChecking yes' \
  "  UserKnownHostsFile $trust_directory/known_hosts" \
  '  GlobalKnownHostsFile /dev/null' \
  '  KnownHostsCommand none' \
  '  UpdateHostKeys no' \
  '  VerifyHostKeyDNS no' \
  '  HostKeyAlgorithms ssh-ed25519' \
  '  BatchMode yes' \
  '  IdentitiesOnly yes' \
  '  IdentityAgent none' > "$trust_directory/ssh_config"
chmod 600 -- "$trust_directory/ssh_config"
