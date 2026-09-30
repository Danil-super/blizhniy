import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../src/lib/server-auth.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function requestWithToken(token = "session-token") {
  return {
    headers: {
      get(name) {
        return name.toLowerCase() === "authorization" ? `Bearer ${token}` : null;
      },
    },
  };
}

function loadServerAuth({ environment = {}, supabaseRest }) {
  const module = { exports: {} };

  new Function("require", "module", "exports", "process", js)(
    (id) => {
      if (id === "@/lib/supabase-rest") {
        return {
          getSupabaseRestConfig: () => ({ key: environment.SUPABASE_SERVICE_ROLE_KEY ?? "" }),
          supabaseRest,
        };
      }

      throw new Error(`Unexpected dependency: ${id}`);
    },
    module,
    module.exports,
    { env: environment },
  );

  return module.exports;
}

const configuredEnvironment = {
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  NEXT_PUBLIC_SUPABASE_URL: "https://database.example.test",
  NODE_ENV: "production",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

test("token verification uses the bounded anonymous Supabase request", async () => {
  const calls = [];
  const auth = loadServerAuth({
    environment: configuredEnvironment,
    supabaseRest: async (path, options) => {
      calls.push({ path, options });
      return { id: "11111111-1111-4111-8111-111111111111" };
    },
  });

  const result = await auth.getVerifiedRequestUser(requestWithToken());

  assert.deepEqual(result, { user: { id: "11111111-1111-4111-8111-111111111111" } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/auth/v1/user");
  assert.equal(calls[0].options.useServiceRole, false);
  assert.equal(calls[0].options.headers.Authorization, "Bearer session-token");
  assert.equal(calls[0].options.attempts, 1);
  assert.ok(calls[0].options.timeoutMs <= 3000);
});

test("authentication failures fail closed without raw fetches", async () => {
  const auth = loadServerAuth({
    environment: configuredEnvironment,
    supabaseRest: async () => {
      throw new DOMException("request timed out", "AbortError");
    },
  });

  assert.equal(await auth.getVerifiedRequestUser(requestWithToken()), null);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
});

test("profile and role failures fail closed with bounded requests", async () => {
  const calls = [];
  const auth = loadServerAuth({
    environment: configuredEnvironment,
    supabaseRest: async (path, options) => {
      calls.push({ path, options });

      if (path === "/auth/v1/user") {
        return { id: "11111111-1111-4111-8111-111111111111" };
      }

      if (path.includes("profiles")) {
        return [{ is_blocked: false }];
      }

      throw new DOMException("request timed out", "AbortError");
    },
  });

  assert.deepEqual(await auth.getAuthenticatedRequestUser(requestWithToken()), { user: { id: "11111111-1111-4111-8111-111111111111" } });
  assert.equal(await auth.isAdminRequest(requestWithToken()), false);
  assert.equal(calls.filter((call) => call.path.includes("profiles")).length, 2);
  assert.equal(calls.filter((call) => call.path.includes("user_roles")).length, 1);
  assert.ok(calls.every((call) => call.options.attempts === 1 && call.options.timeoutMs <= 3000));
});

test("only the explicit admin role grants administrator access", async () => {
  const calls = [];
  const auth = loadServerAuth({
    environment: configuredEnvironment,
    supabaseRest: async (path, options) => {
      calls.push({ path, options });

      if (path === "/auth/v1/user") {
        return { id: "11111111-1111-4111-8111-111111111111" };
      }

      if (path.includes("profiles")) {
        return [{ is_blocked: false }];
      }

      if (path.includes("user_roles")) {
        return [{ role: "admin" }];
      }

      throw new Error(`Unexpected request ${path}`);
    },
  });

  assert.equal(await auth.isAdminRequest(requestWithToken()), true);
  const roleLookup = calls.find((call) => call.path.includes("user_roles"));
  assert.ok(roleLookup);
  assert.equal(roleLookup.options.attempts, 1);
  assert.ok(roleLookup.options.timeoutMs <= 3000);
});

test("blocked users never obtain an authenticated session", async () => {
  const auth = loadServerAuth({
    environment: configuredEnvironment,
    supabaseRest: async (path) => {
      if (path === "/auth/v1/user") {
        return { id: "11111111-1111-4111-8111-111111111111" };
      }

      if (path.includes("profiles")) {
        return [{ is_blocked: true }];
      }

      throw new Error(`Unexpected request ${path}`);
    },
  });

  assert.equal(await auth.getAuthenticatedRequestUser(requestWithToken()), null);
});
