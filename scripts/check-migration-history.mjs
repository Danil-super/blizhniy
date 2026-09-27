#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(join(root, "docs/migration-history-snapshot.json"), "utf8"));
const issues = [];
const counts = { exact: 0, trailing_newline_only: 0, divergent: 0, missing: 0 };
const sha1Blob = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const md5 = (bytes) => createHash("md5").update(bytes).digest("hex");

for (const entry of manifest.migrations) {
  if (!/^\d{14}$/.test(entry.version)) issues.push(`Invalid historical version: ${entry.version}`);
  if (!entry.file) {
    counts.missing++;
    issues.push(`${entry.version} ${entry.name}: applied SQL is absent from repository`);
    continue;
  }
  let bytes;
  try {
    bytes = await readFile(join(root, entry.file));
  } catch {
    issues.push(`${entry.version}: file missing: ${entry.file}`);
    continue;
  }
  if (sha1Blob(bytes) !== entry.blobSha1) {
    issues.push(`${entry.version}: repository file changed since ${manifest.repositoryCommit}: ${entry.file}`);
    continue;
  }
  const actual = md5(bytes) === entry.appliedStatementMd5
    ? "exact"
    : md5(Buffer.from(bytes.toString("utf8").replace(/\n+$/, ""))) === entry.appliedStatementMd5
      ? "trailing_newline_only"
      : "divergent";
  counts[actual]++;
  if (actual !== entry.comparison) issues.push(`${entry.version}: recorded comparison changed: ${entry.comparison} -> ${actual}`);
  if (actual === "divergent") issues.push(`${entry.version}: repository SQL differs from the applied SQL: ${entry.file}`);
}

const expectedPaths = new Set([...manifest.migrations.map((entry) => entry.file).filter(Boolean), ...manifest.repositoryFilesNotInHistory]);
for (const filename of await readdir(join(root, "supabase/migrations"))) {
  if (filename.endsWith(".sql") && !expectedPaths.has(`supabase/migrations/${filename}`)) {
    issues.push(`New migration is not inventoried: supabase/migrations/${filename}`);
  }
}
for (const path of manifest.repositoryFilesNotInHistory) {
  try {
    await readFile(join(root, path));
    issues.push(`SQL file has no applied history entry: ${path}`);
  } catch {
    issues.push(`Untracked migration file disappeared: ${path}`);
  }
}

const historyIndex = process.argv.indexOf("--history");
if (historyIndex !== -1) {
  if (!process.argv[historyIndex + 1]) throw new Error("Expected --history <path-to-version-name-lines>");
  const lines = (await readFile(resolve(process.argv[historyIndex + 1]), "utf8")).trim().split(/\r?\n/);
  const current = lines.map((line) => {
    const [version, name] = line.split("|");
    return { version, name };
  });
  if (current.length !== manifest.migrations.length) issues.push(`History size changed: ${current.length} instead of ${manifest.migrations.length}`);
  for (let i = 0; i < Math.max(current.length, manifest.migrations.length); i++) {
    const expected = manifest.migrations[i];
    const actual = current[i];
    if (expected?.version !== actual?.version || expected?.name !== actual?.name) {
      issues.push(`History row ${i + 1} changed: ${JSON.stringify(actual)} instead of ${JSON.stringify(expected && { version: expected.version, name: expected.name })}`);
    }
  }
}

console.log(`History snapshot ${manifest.migrations.length}, exact=${counts.exact}, trailing-LF=${counts.trailing_newline_only}, divergent=${counts.divergent}, missing=${counts.missing}`);
if (issues.length) {
  for (const issue of issues) console.error(`BLOCKED: ${issue}`);
  process.exitCode = 1;
} else {
  console.log("Migration inventory matches the applied history snapshot.");
}
