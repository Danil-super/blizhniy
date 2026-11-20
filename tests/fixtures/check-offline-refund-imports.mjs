import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [role, ...sources] = process.argv.slice(2);
const requireFromArtifact = createRequire(resolve("manifest.json"));
let calls = 0;
globalThis.fetch = () => { calls++; throw Error("network forbidden"); };
Object.defineProperty(requireFromArtifact("pg"), "Pool", {
  value: class { constructor() { calls++; throw Error("pool forbidden"); } },
});

assert.ok(role === "operator" || role === "worker");
const runtime = role === "operator" ? "local-refund-operator-runtime.mjs" : "local-refund-worker-runtime.mjs";
await import(pathToFileURL(resolve("scripts", runtime)).href);
assert.ok(sources.length > 0);
for (const file of sources) {
  assert.match(file, /^lib\/[a-z0-9-]+\.js$/);
  requireFromArtifact("./compiled/" + file);
}
assert.equal(calls, 0, "Import started work");
console.log("offline");
