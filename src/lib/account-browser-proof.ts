import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

const name = "__Host-blizhniy_human";
const ttl = 900000;
const attributes = "Path=/; Secure; HttpOnly; SameSite=Lax";

function signature(value: string, secret: string, ip: string, agent: string): string {
  if (typeof window !== "undefined" || !/^[a-zA-Z0-9_-]{32,128}$/.test(secret) || !isIP(ip) || agent.length > 2048) {
    throw new Error("Invalid browser proof boundary");
  }
  return createHmac("sha256", secret).update(JSON.stringify(["account-human-v1", value, ip, agent])).digest("hex");
}

/** Anti-bot proof only. Never authorizes an account or replaces password/session checks. */
export function issueBrowserProof(secret: string, ip: string, userAgent: string, nowMs = Date.now()): { cookie: string; expiresAt: number } {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error("Invalid browser proof time");
  const expiresAt = nowMs + ttl;
  const value = `v1.${nowMs}.${expiresAt}.${randomBytes(16).toString("hex")}`;
  const token = `${value}.${signature(value, secret, ip, userAgent)}`;
  return { cookie: `${name}=${token}; ${attributes}; Max-Age=900; Expires=${new Date(expiresAt).toUTCString()}`, expiresAt };
}

export function readBrowserProof(headers: Headers, secret: string, ip: string, nowMs = Date.now()): number {
  const cookie = headers.get("cookie") ?? "";
  const agent = headers.get("user-agent") ?? "";
  if (cookie.length > 16384 || !Number.isSafeInteger(nowMs)) return 0;
  const values = cookie.split(";").map(part => part.trim()).filter(part => part.split("=", 1)[0] === name);
  if (values.length !== 1) return 0;
  const token = values[0].slice(name.length + 1);
  const match = /^(v1\.(\d{1,16})\.(\d{1,16})\.[a-f0-9]{32})\.([a-f0-9]{64})$/.exec(token);
  if (!match) return 0;
  const issued = Number(match[2]), expires = Number(match[3]);
  if (!Number.isSafeInteger(issued) || !Number.isSafeInteger(expires) || String(issued) !== match[2] || String(expires) !== match[3] ||
      issued > nowMs || expires <= nowMs || expires - issued !== ttl) return 0;
  try {
    const expected = Buffer.from(signature(match[1], secret, ip, agent), "hex");
    return timingSafeEqual(expected, Buffer.from(match[4], "hex")) ? expires : 0;
  } catch { return 0; }
}

export function clearBrowserProofCookie(): string {
  return `${name}=; ${attributes}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}
