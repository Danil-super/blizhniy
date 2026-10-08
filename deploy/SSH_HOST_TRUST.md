# Deployment SSH host trust

`vps-host-key.pub` is the public ED25519 host key of the existing VPS. On
2026-10-07 the maintainer retrieved it from `root@217.149.30.35` through an
already-trusted SSH connection with `StrictHostKeyChecking=yes` and the existing
trusted `known_hosts` entry. It was not learned from a new network scan.

Verified fingerprint: `SHA256:HQ0NkbdZ5IqHVzThksum0mniNh730xRaPtkEVctWsos`.
The public host key is not a credential; the existing `VPS_SSH_KEY` secret remains
the client credential. No additional secret or environment variable is required.

Both workflows check out the repository at the existing pinned checkout action
version, then call `scripts/setup-deployment-ssh.sh` with the configured
`VPS_HOST`, `VPS_PORT` and a dedicated directory under `RUNNER_TEMP`. The helper
validates the host, port and existing `VPS_USER` before creating files. Hosts must
be IPv4 addresses or DNS names; ports must be decimal integers from 1 to 65535
without leading zeroes. The pin is bound to that exact host, or `[host]:port` for
a non-default port. Changing an address does not authorize a different host key.

The generated SSH configuration applies to every host and requires the pinned
ED25519 key, strict checking and the dedicated `known_hosts` file. It disables
global known-host trust, DNS key trust, additional key learning and inherited
agent identities. Every deployment SSH/SCP, confirmation, rollback and TLS
journal call selects this configuration and explicitly requires strict checking.
A missing pin/configuration, an unknown host key or a changed key fails closed;
no `ssh-keyscan`, `accept-new` or insecure retry is used. The runner's home SSH
configuration and known-host files are untouched.

## Verified rotation

Before intentionally replacing the VPS key, obtain the replacement through an
already-trusted connection or a separately authenticated provider console or
out-of-band channel. Independently confirm its fingerprint, then review a change
to `vps-host-key.pub` and this provenance record. Replace the exact-pin assertion
in `tests/deployment-ssh-host-trust.test.mjs` in the same reviewed change. If the
old trust is unavailable, stop deployment until independent verification is
complete; do not recover trust with a fresh key scan or disable checking.

## Local regression verification

Run `node --test tests/deployment-ssh-host-trust.test.mjs` on Linux with OpenSSH
client tools and `/usr/sbin/sshd` available. The tests use only generated
synthetic keys and temporary directories. Parsed workflow steps run with fake
SSH/SCP, archive and certificate commands; real `ssh -G` verifies each effective
connection policy. A separate real SSH server listens only on loopback and
proves that a matching pin works while mismatched and missing pins are rejected
without learning keys. No production server, client secret or source archive
transfer is involved.

CI prepares these prerequisites before the regression suite: if a client tool
or `/usr/sbin/sshd` is missing, it installs only the `openssh-client` and
`openssh-server` package selections without recommendations. A temporary
`policy-rc.d` denies package service/socket startup; the prior runner policy is
preserved and restored by an exit trap even if installation fails. CI creates
`/run/sshd` with mode `0755` and explicitly checks all required tools and the
directory. Missing prerequisites fail the job rather than skip the SSH test.
The test runs as the unprivileged runner user, starts its own foreground server
only on loopback, and does not use package-generated system host keys. Parsed
CI-step tests replace privileged/package commands with synthetic local fixtures;
they do not install packages or modify system service policy on the test host.
