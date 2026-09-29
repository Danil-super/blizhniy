import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import { once } from "node:events";
import { test } from "node:test";

function runSmoke(baseUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/check-production-headers.mjs"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, BASE_URL: baseUrl },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(output));
    });
  });
}

test("production header smoke check protects the public response", async (t) => {
  const server = http.createServer((request, response) => {
    assert.equal(request.url, "/");
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Strict-Transport-Security": "max-age=31536000",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
    response.end("<!doctype html><title>ok</title>");
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  t.after(() => server.close());

  const output = await runSmoke(`http://127.0.0.1:${address.port}`);
  assert.match(output, /PASS production headers/);
});

test("deployment confirms a release only after the production header smoke check", () => {
  const workflow = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");

  assert.match(workflow, /name: Check deployed production security headers[\s\S]*run: node scripts\/check-production-headers\.mjs/);
  assert.match(
    workflow,
    /run: node scripts\/check-production-headers\.mjs[\s\S]*name: Confirm deployed release/,
    "the header smoke check must gate release confirmation",
  );
});
