# CAPTCHA trust boundary and rollout

As of 2026-10-15, the direct VPS Caddy upstream uses the header overwrites below,
after validating and reloading its configuration. The previous configuration is
backed up outside Git. The Next process is bound to loopback and runs as the
dedicated web user. Production account confirmation/session/profile and owned
draft writes have exercised this ingress; a socket peer is not a caller header.
Both ingress configuration and the loopback binding are required; the application
cannot authenticate a proxy merely by seeing an `X-Real-IP` HTTP header.

## Required production topology

Internet → this host's Caddy → `127.0.0.1:3000` → one Next process.

Adapt `Caddyfile.example` to the real hostname. Caddy must **replace** `X-Real-IP`
with `{remote_host}` (the socket peer), delete `CF-Connecting-IP`, and replace
`X-Forwarded-For`. The application reads only `X-Real-IP`, accepts one valid IP
literal, and canonicalizes equivalent IPv6/IPv4-mapped spellings. A caller's CF or
XFF headers never choose the CAPTCHA bucket. Missing/malformed trusted IP in
production returns the existing generic CAPTCHA rejection (HTTP 400), not a bypass.

Run the supplied PM2 entry in single-process fork mode. Its Next `-H 127.0.0.1`
binding prevents remote callers reaching port 3000 directly and supplying a fake
`X-Real-IP`. Local processes on the host are inside this trust boundary. A local
SSRF or compromised process is not made safe by this header convention.

Do not put a CDN, proxy, or load balancer in front of this example unchanged: its
socket address would become everyone's identity. A future multi-proxy deployment
needs an explicitly validated trusted-proxy chain. Do not scale to multiple Next
processes/hosts without a shared limiter; each process has its own budget.

Before exposing the new application, an authorized operator must adapt and
validate the ingress example with the installed Caddy, install/reload that config,
then start/restart Next using the supplied loopback-only PM2 entry. Confirm the
socket is bound to `127.0.0.1:3000`, not `*:3000`/`0.0.0.0:3000`/`[::]:3000`,
and that no alternate public upstream bypass exists. Test missing/forged CF/XFF
headers with synthetic CAPTCHA data, never real secrets or reusable tokens. If
rolling back code, retain header overwrites and the loopback binding.

## Resource limits

- Existing client allowance: 40 checks per fixed 60-second window per canonical IP.
- Independent process allowance: 600 checks per fixed 60-second window (10/s
  average, allowing 15 clients to use their entire 40-check allowance).
- At most 16 in-flight provider checks; the existing 5-second abort timeout bounds
  slot occupancy and `finally` releases slots after success, exception or timeout.
- At most 1024 IP buckets, retained only until their 60-second window expires.
  Expired entries are removed lazily on admitted-window attempts. If all entries
  are live, new identities are rejected, never allowed by evicting old entries.
  These capacity rejections consume the global budget to bound cleanup work.
- Tokens must be strings of at most 2048 raw characters before trimming. Objects,
  arrays, numbers and file-valued FormData tokens fail without provider I/O.

These are conservative single-host overload guardrails, not a traffic capacity
benchmark or an edge DDoS service. A saturated global/concurrency limit may reject
legitimate users too. Verify real traffic before increasing them; memory must
remain bounded and live IP buckets must never be evicted to accept a new identity.
The process singleton is shared across route bundles and development reloads, but
does not survive restart. General request/body-size and ingress DDoS protection
remain separate from CAPTCHA admission.

For local development only, with no Turnstile secret and non-production
`NODE_ENV`, the existing `quiet` token simulator remains available. Requests
without proxy identity use one shared `development:unknown` bucket under the same
40/min and global limits. It never calls the real provider. With a secret configured,
even development requires a valid IP. The two existing server actions now forward
`headers()` through the same trusted-IP helper as the two API routes.

## References

- [Caddy reverse_proxy header_up semantics](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy): setting a header replaces incoming values; `-` deletes it.
- [Caddy remote_host placeholder](https://caddyserver.com/docs/caddyfile/concepts): the request's remote socket host, not a client-supplied header.
- [Next start hostname option](https://nextjs.org/docs/app/api-reference/cli/next#next-start-options): `-H` selects the listening host; the default is public `0.0.0.0`.
- [Turnstile server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/): the token maximum is 2048 characters; provider token validity/reuse checks remain authoritative.
