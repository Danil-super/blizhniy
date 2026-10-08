import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";

const policy = readFileSync(new URL("../.npmrc", import.meta.url), "utf8");
const lifecycleEvents = ["preinstall", "install", "postinstall"];

function createFixture(context) {
  const root = mkdtempSync(join(tmpdir(), "blizhniy-npm-policy-"));
  // Only this newly allocated, test-owned directory is removed. No real project,
  // dependency package, environment file or package-manager credential is used.
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const dependency = join(root, "dependency");
  mkdirSync(dependency);
  writeFileSync(join(root, ".npmrc"), policy);
  writeFileSync(join(root, "user.npmrc"), "");
  writeFileSync(join(root, "global.npmrc"), "");
  const markerScript = "require('node:fs').writeFileSync(process.env.npm_lifecycle_event + '.marker', 'synthetic lifecycle executed');\n";
  writeFileSync(join(root, "lifecycle.cjs"), markerScript);
  writeFileSync(join(dependency, "lifecycle.cjs"), markerScript);
  writeFileSync(join(dependency, "package.json"), JSON.stringify({
    name: "synthetic-install-dependency", version: "1.0.0",
    scripts: Object.fromEntries(lifecycleEvents.map((event) => [event, "node lifecycle.cjs"])),
  }));
  function npm(args) {
    // Offline npm and empty explicit configs prevent credential/config inheritance.
    // Select the same Node binary as the test runner for every synthetic script.
    const result = spawnSync("npm", [
      ...args, "--offline", "--audit=false", "--fund=false",
      `--userconfig=${join(root, "user.npmrc")}`,
      `--globalconfig=${join(root, "global.npmrc")}`,
      `--cache=${join(root, "cache")}`,
    ], {
      cwd: root, encoding: "utf8", timeout: 20_000,
      env: { PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}` },
    });
    assert.equal(result.status, 0, `Synthetic npm ${args.join(" ")} failed: ${result.error?.message ?? ""}\n${result.stderr}\n${result.stdout}`);
    return result.stdout;
  }
  // Bootstrap only our inert fixture with an explicit script block. A tarball
  // ensures dependency lifecycle is tested, not file: symlink-install behavior.
  const [packed] = JSON.parse(npm(["pack", "./dependency", "--ignore-scripts", "--json"]));
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "synthetic-policy-consumer", version: "1.0.0", private: true,
    dependencies: { "synthetic-install-dependency": `file:./${packed.filename}` },
    scripts: Object.fromEntries([...lifecycleEvents, "prebuild", "build", "postbuild"].map((event) => [event, "node lifecycle.cjs"])),
  }));
  npm(["install", "--package-lock-only", "--ignore-scripts"]);
  return { root, npm, installedDependency: join(root, "node_modules", "synthetic-install-dependency") };
}

test("ordinary npm ci applies repository policy and blocks dependency and root install lifecycle scripts", (context) => {
  const fixture = createFixture(context);
  fixture.npm(["ci"]);
  assert.ok(existsSync(join(fixture.installedDependency, "package.json")), "The synthetic dependency must really be installed");
  for (const event of lifecycleEvents) {
    assert.equal(existsSync(join(fixture.installedDependency, `${event}.marker`)), false, `Dependency ${event} must not run`);
    assert.equal(existsSync(join(fixture.root, `${event}.marker`)), false, `Root ${event} must not run`);
  }
});

test("ordinary npm ci packs local directories consistently with the locked vendor dependency", (context) => {
  const fixture = createFixture(context);
  assert.equal(fixture.npm(["config", "get", "install-links"]).trim(), "true",
    "Local file dependencies must use the packed layout recorded in the lockfile");
  const manifestPath = join(fixture.root, "dependency", "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  // A packed dependency must not resolve its author's build-only dependencies.
  // This deliberately nonexistent fixture package can never be fetched offline.
  manifest.devDependencies = { "synthetic-uninstalled-build-tool": "99.0.0" };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(join(fixture.root, "package.json"), JSON.stringify({
    name: "synthetic-local-directory-consumer", version: "1.0.0", private: true,
    dependencies: { "synthetic-install-dependency": "file:./dependency" },
  }));
  fixture.npm(["install", "--package-lock-only", "--install-links=true"]);
  const locked = JSON.parse(readFileSync(join(fixture.root, "package-lock.json"), "utf8"));
  assert.equal(locked.packages["node_modules/synthetic-install-dependency"].link, undefined);
  assert.equal(locked.packages["dependency"], undefined);
  fixture.npm(["ci"]);
  assert.equal(lstatSync(fixture.installedDependency).isSymbolicLink(), false);
  assert.equal(existsSync(join(fixture.root, "node_modules", "synthetic-uninstalled-build-tool")), false);
  for (const event of lifecycleEvents) {
    assert.equal(existsSync(join(fixture.installedDependency, `${event}.marker`)), false);
  }
});

test("explicit npm run build still executes the intended project script but not pre/post hooks", (context) => {
  const fixture = createFixture(context);
  fixture.npm(["ci"]);
  fixture.npm(["run", "build"]);
  assert.equal(existsSync(join(fixture.root, "build.marker")), true);
  assert.equal(existsSync(join(fixture.root, "prebuild.marker")), false);
  assert.equal(existsSync(join(fixture.root, "postbuild.marker")), false);
});

test("synthetic negative control proves dependency lifecycle would execute if an operator overrides the policy", (context) => {
  const fixture = createFixture(context);
  // Only the synthetic tarball is allowed here. This is not an instruction to
  // bypass the policy when installing real packages.
  fixture.npm(["ci", "--ignore-scripts=false"]);
  for (const event of lifecycleEvents) {
    assert.equal(existsSync(join(fixture.installedDependency, `${event}.marker`)), true, `Synthetic dependency ${event} must be executable in the negative control`);
    assert.equal(existsSync(join(fixture.root, `${event}.marker`)), true);
  }
});
