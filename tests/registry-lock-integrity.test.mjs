import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("registry dependencies in the npm lockfile pin SHA-512 tarball integrity", () => {
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  for (const [path, pkg] of Object.entries(lock.packages)) {
    if (!path || pkg.link || pkg.resolved?.startsWith("file:")) continue;
    assert.match(pkg.integrity ?? "", /^sha512-[A-Za-z0-9+/]{85}[AQgw]==$/, path);
  }
});
