import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../src/lib/storage-upload.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const environment = {
  NEXT_PUBLIC_SUPABASE_URL: "https://storage.example.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

function imageFile() {
  return {
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    size: 3,
    type: "image/png",
  };
}

function loadStorage({ withServerRequestTimeout }) {
  const module = { exports: {} };

  new Function("require", "module", "exports", "process", js)(
    (id) => {
      if (id === "@/lib/server-request-timeout") {
        return { withServerRequestTimeout };
      }

      if (id === "@/lib/supabase-rest") {
        return { isSupabaseServiceRoleConfigured: () => true };
      }

      throw new Error(`Unexpected dependency: ${id}`);
    },
    module,
    module.exports,
    { env: environment },
  );

  return module.exports;
}

test("media upload bounds the full Storage request", async () => {
  const timeouts = [];
  const storage = loadStorage({
    withServerRequestTimeout: async (timeoutMs, request) => {
      timeouts.push(timeoutMs);
      return request(new AbortController().signal);
    },
  });
  const originalFetch = globalThis.fetch;
  let upstreamRequest;

  globalThis.fetch = async (url, init) => {
    upstreamRequest = { init, url };
    return { ok: true };
  };

  try {
    const uploaded = await storage.uploadMediaFile(
      imageFile(),
      "listings",
      "11111111-1111-4111-8111-111111111111",
    );

    assert.equal(uploaded.mimeType, "image/png");
    assert.equal(uploaded.size, 3);
    assert.match(uploaded.path, /^listings\/11111111-1111-4111-8111-111111111111\//);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(timeouts, [20000]);
  assert.equal(upstreamRequest.init.signal.aborted, false);
  assert.equal(upstreamRequest.init.headers.Authorization, "Bearer service-role-key");
  assert.match(upstreamRequest.url, /^https:\/\/storage\.example\.test\/storage\/v1\/object\/blizhniy-media\//);
});

test("Storage timeout and upstream errors expose a safe retry message", async () => {
  const storage = loadStorage({
    withServerRequestTimeout: async () => {
      throw new DOMException("upstream timed out", "AbortError");
    },
  });

  await assert.rejects(
    storage.uploadMediaFile(imageFile(), "listings", "11111111-1111-4111-8111-111111111111"),
    /Не удалось загрузить файл\. Повторите попытку\./,
  );
  assert.match(source, /withServerRequestTimeout\(mediaUploadTimeoutMs/);
});

test("cleanup submits only this owner's generated keys to Storage", async (t) => {
  const owner = "11111111-1111-4111-8111-111111111111";
  const objectKey = "listings/" + owner + "/2026-11-18/11111111-1111-4111-8111-111111111111.png";
  const storage = loadStorage({
    withServerRequestTimeout: (timeout, callback) => {
      assert.equal(timeout, 20000);
      return callback(new AbortController().signal);
    },
  });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status: 200 });
  });

  for (const paths of [[], Array(11).fill(objectKey), [objectKey, "listings/other/photo.png"],
      [objectKey.replace("listings/", "vacancies/")], [objectKey + "/../photo.png"]]) {
    await assert.rejects(storage.removeUploadedMedia(paths, "listings", owner), /Invalid media cleanup/);
  }
  assert.equal(calls.length, 0);
  await storage.removeUploadedMedia([objectKey], "listings", owner);
  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  assert.equal(url, environment.NEXT_PUBLIC_SUPABASE_URL + "/storage/v1/object/blizhniy-media");
  assert.equal(init.method, "DELETE");
  assert.equal(init.redirect, "error");
  assert.deepEqual(JSON.parse(init.body), { prefixes: [objectKey] });
  assert.equal(init.headers.Authorization, "Bearer " + environment.SUPABASE_SERVICE_ROLE_KEY);
});

test("confirmed upload retains its receipt even if discarding the response body fails", async (t) => {
  const storage = loadStorage({
    withServerRequestTimeout: (_timeout, callback) => callback(new AbortController().signal),
  });
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    body: { cancel: async () => { throw Error("connection closed"); } },
  }));
  const receipt = await storage.uploadMediaFile(imageFile(), "listings", "owner");
  assert.equal(receipt.size, 3);
});

test("a dropped upload response is recovered only from matching object metadata", async (t) => {
  const storage = loadStorage({
    withServerRequestTimeout: (_timeout, callback) => callback(new AbortController().signal),
  });
  let current;
  let fault;
  let failStatus;
  let writes = 0;
  let reads = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (init.method === "POST") {
      writes++;
      const prefix = environment.NEXT_PUBLIC_SUPABASE_URL + "/storage/v1/object/blizhniy-media/";
      current = { name: url.slice(prefix.length), bucket_id: "blizhniy-media", content_type: "image/png",
        size: 3, metadata: JSON.parse(Buffer.from(init.headers["x-metadata"], "base64").toString()) };
      if (failStatus) return new Response(null, {status: failStatus});
      throw Error("reply lost after commit");
    }
    reads++;
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.equal(url, environment.NEXT_PUBLIC_SUPABASE_URL + "/storage/v1/object/info/authenticated/blizhniy-media/" + current.name);
    if (fault === "missing") return new Response(null, {status:404});
    if (fault === "bad-json") return new Response("truncated json");
    if (fault === "oversize") return Response.json({...current, padding:"x".repeat(32768)});
    if (fault === "different") return Response.json({...current, metadata:{uploadAttempt:"other"}});
    if (fault === "wrong-size") return Response.json({...current, size:42});
    return Response.json(current);
  });
  const upload = () => storage.uploadMediaFile(imageFile(), "listings", "owner");
  for (failStatus of [0, 502]) {
    assert.equal((await upload()).path, current.name);
  }
  for (fault of ["missing", "bad-json", "oversize", "different", "wrong-size"]) {
    await assert.rejects(upload(), /Не удалось загрузить файл/);
  }
  failStatus = 409;
  await assert.rejects(upload(), /Не удалось загрузить файл/);
  assert.equal(writes, 8);
  assert.equal(reads, 7);
});
