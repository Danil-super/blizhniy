import { isIP } from "node:net";

// Accept one IP literal only, not a forwarded list, port or IPv6 scope ID.
// Canonicalization prevents equivalent IPv6 spellings creating new buckets.
export function normalizeRemoteIp(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 45 || value.includes("%")) {
    return undefined;
  }

  const version = isIP(value);

  if (version === 4) {
    return value;
  }

  if (version !== 6) {
    return undefined;
  }

  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mappedIpv4 = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);

  if (mappedIpv4) {
    const high = Number.parseInt(mappedIpv4[1], 16);
    const low = Number.parseInt(mappedIpv4[2], 16);
    return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
  }

  return canonical;
}

// This header is trustworthy ONLY behind the documented local ingress: Caddy
// overwrites it from the socket peer and Next listens on 127.0.0.1, not a public
// interface. Never fall back to caller-controlled CF-Connecting-IP or XFF.
export function getTrustedProxyIp(headers: Pick<Headers, "get">): string | undefined {
  return normalizeRemoteIp(headers.get("x-real-ip"));
}
