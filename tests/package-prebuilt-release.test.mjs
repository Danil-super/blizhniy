import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { packagePrebuiltRelease } from "../scripts/package-prebuilt-release.mjs";

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "blizhniy-package-test-")), source = join(root, "source");
  mkdirSync(source);
  const files = {
    ".gitignore": ".next/\n",
    "package-lock.json": '{"lockfileVersion":3}', "ecosystem.config.cjs": "module.exports = {};",
    "scripts/check-auth-captcha-env.cjs": "// synthetic guard",
    "scripts/web-runtime.cjs": "// synthetic runtime guard",
    "public/icon.svg": "synthetic-static", ".next/static/chunk.js": "synthetic-browser-chunk",
    ".next/standalone/server.js": "// synthetic server", ".next/standalone/.next/BUILD_ID": "placeholder",
    ".next/standalone/node_modules/@next/env/package.json": '{"name":"@next/env"}',
    ".next/standalone/.env.production": "synthetic-private-env-sentinel",
    ".next/standalone/nested/test.key": "synthetic-private-key-sentinel",
    ".next/standalone/.git/config": "synthetic-private-git-sentinel",
  };
  for (const [name, value] of Object.entries(files)) {
    mkdirSync(join(source, name, ".."), { recursive: true }); writeFileSync(join(source, name), value);
  }
  const git = args => {
    const result = spawnSync("git", ["-C", source, ...args], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } });
    assert.equal(result.status, 0); return result.stdout.trim();
  };
  git(["init", "-q"]);
  git(["add", ".gitignore", "package-lock.json", "ecosystem.config.cjs", "scripts", "public"]);
  git(["-c", "user.name=Package fixture", "-c", "user.email=package@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "synthetic fixture"]);
  const commit = git(["rev-parse", "HEAD"]);
  writeFileSync(join(source, ".next/BUILD_ID"), commit);
  writeFileSync(join(source, ".next/standalone/.next/BUILD_ID"), commit);
  try { return run({ root, source, commit, output: join(root, "release.tar.gz") }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("standalone package includes static assets and manifest but excludes environment and key files", () => fixture(({ root, source, commit, output }) => {
  const result = packagePrebuiltRelease({ source, output, commit });
  assert.equal(result.sha256, createHash("sha256").update(readFileSync(output)).digest("hex"));
  const unpack = join(root, "unpack"); mkdirSync(unpack);
  assert.equal(spawnSync("tar", ["-xzf", output, "-C", unpack]).status, 0);
  assert.equal(readFileSync(join(unpack, "server.js"), "utf8"), "// synthetic server");
  assert.equal(readFileSync(join(unpack, "public/icon.svg"), "utf8"), "synthetic-static");
  assert.equal(readFileSync(join(unpack, ".next/static/chunk.js"), "utf8"), "synthetic-browser-chunk");
  assert.equal(readFileSync(join(unpack, "scripts/web-runtime.cjs"), "utf8"), "// synthetic runtime guard");
  const manifest = JSON.parse(readFileSync(join(unpack, "release-manifest.json"), "utf8"));
  assert.equal(manifest.commit, commit);
  assert.equal(manifest.lockfileSha256, createHash("sha256").update(readFileSync(join(source, "package-lock.json"))).digest("hex"));
  const list = spawnSync("tar", ["-tzf", output], { encoding: "utf8" }).stdout;
  assert.doesNotMatch(list, /\.env|\.key|\.git\/|tasks\//);
}));

test("package refuses a different build, dirty source, symlinks and existing output without overwrite", () => fixture(({ source, commit, output }) => {
  writeFileSync(output, "existing-owned-output");
  assert.throws(() => packagePrebuiltRelease({ source, output, commit }), /output/i);
  assert.equal(readFileSync(output, "utf8"), "existing-owned-output");
  const fresh = output + ".new";
  assert.throws(() => packagePrebuiltRelease({ source, output: fresh, commit: "0".repeat(40) }), /commit|build/i);
  writeFileSync(join(source, ".next/standalone/.next/BUILD_ID"), "another-build");
  assert.throws(() => packagePrebuiltRelease({ source, output: fresh, commit }), /build/i);
  writeFileSync(join(source, ".next/standalone/.next/BUILD_ID"), commit);
  symlinkSync("/etc/passwd", join(source, ".next/standalone/untrusted-link"));
  assert.throws(() => packagePrebuiltRelease({ source, output: fresh, commit }), /symbolic/i);
  rmSync(join(source, ".next/standalone/untrusted-link"));
  writeFileSync(join(source, "ecosystem.config.cjs"), "// dirty source");
  assert.throws(() => packagePrebuiltRelease({ source, output: fresh, commit }), /dirty/i);
}));
