import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../src/lib/turnstile.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function loadTurnstile({ environment = {}, withServerRequestTimeout }) {
  const module = { exports: {} };

  new Function("require", "module", "exports", "process", js)(
    (id) => {
      if (id === "@/lib/server-request-timeout") {
        return { withServerRequestTimeout };
      }

      if (id === "@/lib/turnstile-shared") {
        return { TURNSTILE_ERROR_MESSAGE: "Проверка не пройдена" };
      }

      throw new Error(`Unexpected dependency: ${id}`);
    },
    module,
    module.exports,
    { env: environment },
  );

  return module.exports;
}

test("Turnstile verification is bounded and forwards the upstream result", async () => {
  const timeouts = [];
  const turnstile = loadTurnstile({
    environment: { TURNSTILE_SECRET_KEY: "turnstile-secret" },
    withServerRequestTimeout: async (timeoutMs, request) => {
      timeouts.push(timeoutMs);
      return request(new AbortController().signal);
    },
  });
  const originalFetch = globalThis.fetch;
  let upstreamRequest;

  globalThis.fetch = async (url, init) => {
    upstreamRequest = { init, url };
    return {
      ok: true,
      json: async () => ({ success: true }),
    };
  };

  try {
    assert.equal(await turnstile.verifyTurnstileToken("captcha-token", "203.0.113.7"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(timeouts, [5000]);
  assert.equal(upstreamRequest.url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  assert.equal(upstreamRequest.init.signal.aborted, false);
  assert.equal(upstreamRequest.init.body.get("secret"), "turnstile-secret");
  assert.equal(upstreamRequest.init.body.get("response"), "captcha-token");
  assert.equal(upstreamRequest.init.body.get("remoteip"), "203.0.113.7");
});

test("a failed or timed-out Turnstile verifier fails closed", async () => {
  const turnstile = loadTurnstile({
    environment: { TURNSTILE_SECRET_KEY: "turnstile-secret" },
    withServerRequestTimeout: async () => {
      throw new DOMException("upstream timed out", "AbortError");
    },
  });

  assert.equal(await turnstile.verifyTurnstileToken("captcha-token", "203.0.113.8"), false);
  assert.match(source, /withServerRequestTimeout\(turnstileVerificationTimeoutMs/);
});
