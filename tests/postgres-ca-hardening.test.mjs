import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rootCertificates } from "node:tls";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = fs.readFileSync(new URL("../src/lib/postgres.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText;
const readPostgresConfig = loadWithFs(fs);
const ca = rootCertificates[0];
const limit = 65536;
const remote = {
  NODE_ENV: "production", BLIZHNIY_DB_HOST: "db.example.ru", BLIZHNIY_DB_PORT: "5432",
  BLIZHNIY_DB_NAME: "synthetic_db", BLIZHNIY_DB_USER: "synthetic_user",
  BLIZHNIY_DB_PASSWORD: "synthetic-test-password", BLIZHNIY_DB_SSL_MODE: "verify-full",
};
const configFor = (path) => ({ ...remote, BLIZHNIY_DB_CA_FILE: path });
const invalid = { message: "Invalid PostgreSQL configuration" };

function fixture(t, contents = ca, mode = 0o644) {
  const directory = fs.mkdtempSync(join(tmpdir(), "blizhniy-ca-hardening-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "ca.pem");
  fs.writeFileSync(path, contents);
  fs.chmodSync(path, mode);
  return { directory, path };
}

// Only the fs boundary is replaced. The complete, actual production module is
// transpiled unchanged; crypto/pg and every other import keep their real behavior.
function loadWithFs(adapter) {
  const exports = {};
  new Function("require", "exports", compiled)((name) => name === "node:fs" ? adapter : require(name), exports);
  return exports.readPostgresConfig;
}

function trackedFs(overrides = {}) {
  const opened = [];
  const closed = [];
  const adapter = {
    ...fs,
    openSync(...args) {
      const fd = fs.openSync(...args);
      opened.push(fd);
      return fd;
    },
    closeSync(fd) {
      closed.push(fd);
      return fs.closeSync(fd);
    },
    ...overrides,
  };
  return { adapter, opened, closed };
}

test("CA hardening: a public 0644 CA preserves verify-full and hostname checking", (t) => {
  const { path } = fixture(t);
  const result = readPostgresConfig(configFor(path));
  assert.equal(result.host, remote.BLIZHNIY_DB_HOST);
  assert.deepEqual(result.ssl, { ca, rejectUnauthorized: true });
});

test("CA hardening: verify-full still requires an explicit CA file", () => {
  assert.throws(() => readPostgresConfig(remote), invalid);
});

test("CA hardening: an actual symlink to a valid CA is rejected", (t) => {
  const { directory, path } = fixture(t);
  const link = join(directory, "ca-link.pem");
  fs.symlinkSync(path, link);
  assert.throws(() => readPostgresConfig(configFor(link)), invalid);
});

for (const mode of [0o666, 0o664, 0o646]) {
  test(`CA hardening: group/other writable CA mode ${mode.toString(8)} is rejected`, (t) => {
    const { path } = fixture(t, ca, mode);
    assert.throws(() => readPostgresConfig(configFor(path)), invalid);
  });
}

test("CA hardening: a directory is rejected", (t) => {
  const { directory } = fixture(t);
  assert.throws(() => readPostgresConfig(configFor(directory)), invalid);
});

test("CA hardening: a FIFO is rejected without waiting for a writer", (t) => {
  const { directory } = fixture(t);
  const fifo = join(directory, "ca-fifo");
  const creation = spawnSync("mkfifo", [fifo], { timeout: 2000, encoding: "utf8" });
  assert.equal(creation.error, undefined);
  assert.equal(creation.status, 0, creation.stderr);
  const child = spawnSync(process.execPath, ["-e", `
    const moduleExports = {};
    new Function("require", "exports", ${JSON.stringify(compiled)})(require, moduleExports);
    const { readPostgresConfig } = moduleExports;
    try { readPostgresConfig(JSON.parse(process.argv[1])); process.exitCode = 1; }
    catch (error) { if (error.message !== "Invalid PostgreSQL configuration") process.exitCode = 2; }
  `, JSON.stringify(configFor(fifo))], { timeout: 2000, encoding: "utf8" });
  assert.equal(child.error?.code, undefined, "CA loading must not block on a FIFO");
  assert.equal(child.status, 0, child.stderr);
});

for (const [name, contents] of [["empty", ""], ["oversized", ca.padEnd(limit + 1, " ")]]) {
  test(`CA hardening: ${name} file is rejected`, (t) => {
    const { path } = fixture(t, contents);
    assert.throws(() => readPostgresConfig(configFor(path)), invalid);
  });
}

test("CA hardening: a valid CA at the 65536-byte boundary is accepted", (t) => {
  const contents = ca.padEnd(limit, " ");
  const { path } = fixture(t, contents);
  assert.deepEqual(readPostgresConfig(configFor(path)).ssl, { ca: contents, rejectUnauthorized: true });
});

test("CA hardening: validation and reading use the same opened file despite path replacement", (t) => {
  const { path } = fixture(t);
  let replaced = false;
  const replacePath = () => {
    if (replaced) return;
    replaced = true;
    fs.renameSync(path, `${path}.original`);
    fs.writeFileSync(path, rootCertificates[1], { mode: 0o644 });
  };
  const tracking = trackedFs();
  const originalOpen = tracking.adapter.openSync;
  const reader = loadWithFs({
    ...tracking.adapter,
    statSync(target, ...args) {
      const result = fs.statSync(target, ...args);
      if (target === path) replacePath();
      return result;
    },
    openSync(target, ...args) {
      const fd = originalOpen(target, ...args);
      if (target === path) replacePath();
      return fd;
    },
  });
  assert.ok(reader(configFor(path)).ssl.ca === ca, "replacement path must not become the trusted CA");
  assert.equal(replaced, true, "fixture must exercise the replacement window");
  assert.equal(tracking.opened.length, 1);
  assert.deepEqual(tracking.closed, tracking.opened);
});

test("CA hardening: growth after metadata validation is rejected with at most 65537 bytes read", (t) => {
  const { path } = fixture(t);
  let grown = false;
  let bytesRead = 0;
  let requested = 0;
  let unboundedRead = false;
  const grow = () => {
    if (grown) return;
    grown = true;
    fs.appendFileSync(path, " ".repeat(limit * 4));
  };
  const tracking = trackedFs();
  const reader = loadWithFs({
    ...tracking.adapter,
    statSync(...args) { const result = fs.statSync(...args); grow(); return result; },
    fstatSync(...args) { const result = fs.fstatSync(...args); grow(); return result; },
    readSync(fd, buffer, ...args) {
      const length = typeof args[0] === "object" ? (args[0].length ?? buffer.byteLength) : (args[1] ?? buffer.byteLength);
      requested += length;
      const count = fs.readSync(fd, buffer, ...args);
      bytesRead += count;
      return count;
    },
    readFileSync(...args) { unboundedRead = true; return fs.readFileSync(...args); },
  });
  assert.throws(() => reader(configFor(path)), invalid);
  assert.equal(grown, true);
  assert.equal(unboundedRead, false, "whole-file reads cannot enforce the read bound");
  assert.ok(bytesRead <= limit + 1, `read ${bytesRead} bytes`);
  assert.ok(requested <= limit + 1, `requested ${requested} bytes`);
  assert.equal(tracking.opened.length, 1);
  assert.deepEqual(tracking.closed, tracking.opened);
});

test("CA hardening: a valid CA with an unrelated owner is rejected", (t) => {
  const { path } = fixture(t);
  const unrelatedUid = process.getuid() + 1;
  const changeOwner = (stats) => Object.assign(Object.create(stats), { uid: unrelatedUid });
  const tracking = trackedFs({
    statSync(...args) { return changeOwner(fs.statSync(...args)); },
    fstatSync(...args) { return changeOwner(fs.fstatSync(...args)); },
  });
  assert.throws(() => loadWithFs(tracking.adapter)(configFor(path)), invalid);
});

test("CA hardening: a root-owned public CA remains allowed", (t) => {
  const { path } = fixture(t);
  const rootOwned = (stats) => Object.assign(Object.create(stats), { uid: 0 });
  const tracking = trackedFs({
    statSync(...args) { return rootOwned(fs.statSync(...args)); },
    fstatSync(...args) { return rootOwned(fs.fstatSync(...args)); },
  });
  assert.deepEqual(loadWithFs(tracking.adapter)(configFor(path)).ssl, { ca, rejectUnauthorized: true });
});

test("CA hardening: short descriptor reads still assemble the entire valid CA", (t) => {
  const { path } = fixture(t);
  const tracking = trackedFs({
    readSync(fd, buffer, offset = 0, length = buffer.byteLength, position = null) {
      if (typeof offset === "object") {
        return fs.readSync(fd, buffer, { ...offset, length: Math.min(offset.length ?? buffer.byteLength, 37) });
      }
      return fs.readSync(fd, buffer, offset, Math.min(length, 37), position);
    },
  });
  assert.deepEqual(loadWithFs(tracking.adapter)(configFor(path)).ssl, { ca, rejectUnauthorized: true });
  assert.equal(tracking.opened.length, 1);
  assert.deepEqual(tracking.closed, tracking.opened);
});

for (const failure of ["metadata", "read", "certificate"]) {
  test(`CA hardening: the descriptor closes when ${failure} validation fails`, (t) => {
    const { path } = fixture(t, failure === "certificate" ? "not a certificate" : ca);
    const tracking = trackedFs();
    const adapter = { ...tracking.adapter };
    if (failure === "metadata") adapter.fstatSync = () => { throw new Error("synthetic fstat failure"); };
    if (failure === "read") {
      adapter.readSync = () => { throw new Error("synthetic read failure"); };
      adapter.readFileSync = () => { throw new Error("synthetic read failure"); };
    }
    assert.throws(() => loadWithFs(adapter)(configFor(path)), invalid);
    assert.equal(tracking.opened.length, 1, "one CA descriptor must be acquired");
    assert.deepEqual(tracking.closed, tracking.opened, "every acquired CA descriptor must close once");
  });
}

test("CA hardening: a successful CA load also closes its descriptor", (t) => {
  const { path } = fixture(t);
  const tracking = trackedFs();
  assert.deepEqual(loadWithFs(tracking.adapter)(configFor(path)).ssl, { ca, rejectUnauthorized: true });
  assert.equal(tracking.opened.length, 1);
  assert.deepEqual(tracking.closed, tracking.opened);
});

test("CA hardening: a close failure never exposes a raw filesystem error or retries closing", (t) => {
  const { path } = fixture(t);
  const tracking = trackedFs();
  const reader = loadWithFs({ ...tracking.adapter, closeSync(fd) {
    tracking.adapter.closeSync(fd);
    throw new Error("synthetic raw close failure with internal path");
  } });
  assert.throws(() => reader(configFor(path)), invalid);
  assert.equal(tracking.opened.length, 1);
  assert.deepEqual(tracking.closed, tracking.opened);
});
