import { cpSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const digest = buffer => createHash("sha256").update(buffer).digest("hex");
function command(name, args, cwd) {
  const result = spawnSync(name, args, { cwd, encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Prebuilt ${name} check failed`);
  return result.stdout.trim();
}
function publicFile(source) {
  const name = basename(source);
  if (name === ".git" || name === ".pm2") return false;
  if (name === ".env" || name.startsWith(".env.") || /\.(pem|key|crt)$/i.test(name)) return false;
  const entry = lstatSync(source);
  if (entry.isSymbolicLink()) throw new Error("Prebuilt input contains a symbolic link");
  if (!entry.isFile() && !entry.isDirectory()) throw new Error("Prebuilt input contains a special file");
  return true;
}

/** Own trusted builder only: metadata is not a signature or an attestation of an untrusted build. */
export function packagePrebuiltRelease({ source, output, commit }) {
  if (process.platform !== "linux" || process.arch !== "x64" || !process.version.startsWith("v22.") ||
      !process.report.getReport().header.glibcVersionRuntime) throw new Error("Prebuilt packaging requires Linux x64/glibc/Node22");
  if (!/^[a-f0-9]{40}$/.test(commit ?? "")) throw new Error("Prebuilt commit must be a full Git SHA");
  const root = realpathSync(resolve(source));
  const destination = join(realpathSync(dirname(resolve(output))), basename(output));
  const pathInSource = relative(root, destination);
  if (!isAbsolute(pathInSource) && pathInSource !== ".." && !pathInSource.startsWith(`..${sep}`)) {
    throw new Error("Prebuilt output must be outside the source directory");
  }
  if (existsSync(destination)) throw new Error("Prebuilt output already exists");
  if (command("git", ["rev-parse", "HEAD"], root) !== commit) throw new Error("Prebuilt commit does not match checkout");
  if (command("git", ["status", "--porcelain", "--untracked-files=all"], root)) throw new Error("Prebuilt source checkout is dirty");
  for (const directory of [".next", ".next/standalone", ".next/static", "public", "scripts"]) {
    if (!publicFile(join(root, directory)) || !statSync(join(root, directory)).isDirectory()) throw new Error("Prebuilt required directory is missing");
  }
  for (const name of [".next/BUILD_ID", ".next/standalone/.next/BUILD_ID"]) {
    if (readFileSync(join(root, name), "utf8").trim() !== commit) throw new Error("Prebuilt build ID does not match commit");
  }
  const lockfile = readFileSync(join(root, "package-lock.json"));
  // Require the exact tracked lockfile, not a silently rewritten dependency graph.
  const trackedLockfile = spawnSync("git", ["show", `${commit}:package-lock.json`], { cwd: root, timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  if (trackedLockfile.status !== 0 || !lockfile.equals(trackedLockfile.stdout)) throw new Error("Prebuilt lockfile does not match commit");
  for (const file of [".next/standalone/server.js", ".next/standalone/node_modules/@next/env/package.json", "ecosystem.config.cjs", "scripts/check-auth-captcha-env.cjs"]) {
    if (!publicFile(join(root, file)) || !statSync(join(root, file)).isFile()) throw new Error("Prebuilt required input is missing");
  }
  const temporary = mkdtempSync(join(tmpdir(), "blizhniy-prebuilt-package-"));
  try {
    const stage = join(temporary, "package"); mkdirSync(stage, { mode: 0o700 });
    const copy = (from, to) => cpSync(join(root, from), join(stage, to), { recursive: true, filter: publicFile });
    copy(".next/standalone", ".");
    copy("public", "public");
    copy(".next/static", ".next/static");
    copy("ecosystem.config.cjs", "ecosystem.config.cjs");
    copy("scripts/check-auth-captcha-env.cjs", "scripts/check-auth-captcha-env.cjs");
    copy("package-lock.json", "package-lock.json");
    writeFileSync(join(stage, "release-manifest.json"), JSON.stringify({ format: 1, commit, buildId: commit,
      lockfileSha256: digest(lockfile), node: process.version, platform: process.platform, arch: process.arch,
      glibc: process.report.getReport().header.glibcVersionRuntime }, null, 2) + "\n", { mode: 0o600 });
    const archive = join(temporary, "release.tar.gz");
    command("tar", ["-czf", archive, "-C", stage, "."], root);
    const bytes = readFileSync(archive);
    // Exclusive publication: never overwrite a previous artifact, including a dangling symlink.
    // Temporary archive must share a filesystem with the destination for linkSync.
    const publish = mkdtempSync(join(dirname(destination), ".blizhniy-package-publish-"));
    try {
      const ready = join(publish, "release.tar.gz"); writeFileSync(ready, bytes, { mode: 0o600, flag: "wx" });
      linkSync(ready, destination);
    } finally { rmSync(publish, { recursive: true, force: true }); }
    return { commit, sha256: digest(bytes), bytes: bytes.length };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 5) throw new Error("Usage: node scripts/package-prebuilt-release.mjs <source-dir> <new-archive> <commit-sha>");
    console.log(JSON.stringify(packagePrebuiltRelease({ source: process.argv[2], output: process.argv[3], commit: process.argv[4] })));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
