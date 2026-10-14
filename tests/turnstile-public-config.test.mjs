import assert from "node:assert/strict";
import { test } from "node:test";
import { getTurnstileSiteKey } from "../src/lib/turnstile-public-config.ts";

test("server public CAPTCHA key is read at request time, not frozen when the module loads", () => {
  const previous = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  try {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "  synthetic-runtime-site-key-A  ";
    assert.equal(getTurnstileSiteKey(), "synthetic-runtime-site-key-A");
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "synthetic-runtime-site-key-B";
    assert.equal(getTurnstileSiteKey(), "synthetic-runtime-site-key-B");
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    assert.equal(getTurnstileSiteKey(), undefined);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    else process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = previous;
  }
});
test("browser consumes only the server public meta value, never a build-time or secret fallback", () => {
  const previousKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const previousDocument = globalThis.document;
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "synthetic-build-key-not-authority";
  try {
    globalThis.document = { querySelector: selector => {
      assert.equal(selector, 'meta[name="blizhniy-turnstile-site-key"]');
      return { getAttribute: name => { assert.equal(name, "content");return "  synthetic-response-site-key  "; } };
    } };
    assert.equal(getTurnstileSiteKey(), "synthetic-response-site-key");
    globalThis.document = { querySelector: () => ({ getAttribute: () => "" }) };
    assert.equal(getTurnstileSiteKey(), undefined);
    globalThis.document = { querySelector: () => null };
    assert.equal(getTurnstileSiteKey(), undefined);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;else globalThis.document = previousDocument;
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;else process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = previousKey;
  }
});
