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

function assertRepeatedHeader(name, expected) {
  const values = requiredHeader(name).split(",").map((value) => value.trim());
  assert.ok(values.length > 0 && values.every((value) => value.toLowerCase() === expected.toLowerCase()), `home page: ${name} must be ${expected}`);
}

const hsts = requiredHeader("strict-transport-security");
const hstsMaxAge = Number(hsts.match(/(?:^|;)\s*max-age=(\d+)/i)?.[1]);
assert.ok(Number.isFinite(hstsMaxAge) && hstsMaxAge >= 31_536_000, "home page: HSTS max-age must be at least one year");
assertRepeatedHeader("x-content-type-options", "nosniff");
assertRepeatedHeader("x-frame-options", "SAMEORIGIN");
assertRepeatedHeader("referrer-policy", "strict-origin-when-cross-origin");

const permissions = requiredHeader("permissions-policy");
for (const disabledFeature of ["camera=()", "microphone=()", "geolocation=()"]) {
  assert.ok(permissions.includes(disabledFeature), `home page: permissions policy must disable ${disabledFeature}`);
}

assert.equal(response.headers.get("x-powered-by"), null, "home page: must not expose framework header");

console.log("PASS production headers: HSTS, anti-sniffing, clickjacking, referrer and permissions policies");
