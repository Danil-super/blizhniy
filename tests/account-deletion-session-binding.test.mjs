import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../src/components/cabinet/AccountDeletionRequestClient.tsx", import.meta.url), "utf8");

function loadSubmissionHelper() {
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module = { exports: {} };

  vm.runInNewContext(js, {
    module,
    exports: module.exports,
    Error,
    Promise,
    require(id) {
      if (id === "next/link") return { default: "Link" };
      if (id === "react") return { useEffect() {}, useRef() {}, useState() {} };
      if (id === "react/jsx-runtime") return { jsx() {}, jsxs() {} };
      if (id === "@/lib/supabase-browser") return { getSupabaseBrowserClient() {} };
      throw new Error(`Unexpected module: ${id}`);
    },
  });

  return module.exports.submitBoundAccountDeletionRequest;
}

function session(userId, accessToken) {
  return {
    data: { session: { user: { id: userId }, access_token: accessToken } },
    error: null,
  };
}

function createDeferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

test("account deletion aborts before POST when the browser session switches from A to B", async () => {
  const submitBoundAccountDeletionRequest = loadSubmissionHelper();
  const currentSession = createDeferred();
  const postTokens = [];
  const pending = submitBoundAccountDeletionRequest(
    { userId: "account-a", accessToken: "token-a" },
    () => currentSession.promise,
    async (accessToken) => {
      postTokens.push(accessToken);
      return { ok: true };
    },
    () => true,
  );

  await Promise.resolve();
  currentSession.resolve(session("account-b", "token-b"));

  await assert.rejects(pending, /Сессия изменилась/);
  assert.deepEqual(postTokens, []);
});

test("account deletion posts with the captured origin token after stable session checks", async () => {
  const submitBoundAccountDeletionRequest = loadSubmissionHelper();
  const postTokens = [];
  const response = { ok: true };
  let sessionChecks = 0;

  const actualResponse = await submitBoundAccountDeletionRequest(
    { userId: "account-a", accessToken: "token-a" },
    async () => {
      sessionChecks += 1;
      return session("account-a", "token-a");
    },
    async (accessToken) => {
      postTokens.push(accessToken);
      return response;
    },
    () => true,
  );

  assert.equal(actualResponse, response);
  assert.deepEqual(postTokens, ["token-a"]);
  assert.equal(sessionChecks, 2, "the current session is checked before and after POST");
});
