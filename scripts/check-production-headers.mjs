import assert from "node:assert/strict";

const baseUrl = process.env.BASE_URL;
assert.ok(baseUrl, "BASE_URL is required");

const response = await fetch(new URL("/", baseUrl), {
  cache: "no-store",
  redirect: "manual",
  signal: AbortSignal.timeout(15_000),
});

assert.equal(response.status, 200, "home page: expected HTTP 200");
assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i, "home page: expected HTML response");

function requiredHeader(name) {
  const value = response.headers.get(name);
  assert.ok(value, `home page: missing ${name}`);
  return value;
}

const hsts = requiredHeader("strict-transport-security");
const hstsMaxAge = Number(hsts.match(/(?:^|;)\s*max-age=(\d+)/i)?.[1]);
assert.ok(Number.isFinite(hstsMaxAge) && hstsMaxAge >= 31_536_000, "home page: HSTS max-age must be at least one year");
assert.match(requiredHeader("x-content-type-options"), /^nosniff$/i, "home page: X-Content-Type-Options must be nosniff");
assert.match(requiredHeader("x-frame-options"), /^sameorigin$/i, "home page: X-Frame-Options must be SAMEORIGIN");
assert.match(requiredHeader("referrer-policy"), /^strict-origin-when-cross-origin$/i, "home page: unexpected referrer policy");

const permissions = requiredHeader("permissions-policy");
for (const disabledFeature of ["camera=()", "microphone=()", "geolocation=()"]) {
  assert.ok(permissions.includes(disabledFeature), `home page: permissions policy must disable ${disabledFeature}`);
}

assert.equal(response.headers.get("x-powered-by"), null, "home page: must not expose framework header");

console.log("PASS production headers: HSTS, anti-sniffing, clickjacking, referrer and permissions policies");
