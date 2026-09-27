#!/usr/bin/env node
// Verifies the read-only archive of SQL actually recorded by Supabase.
// This intentionally never executes a statement or changes migration history.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const archivePath = new URL("../docs/applied-migrations-2026-09-27.json", import.meta.url);
const archive = JSON.parse(readFileSync(archivePath, "utf8"));
const rows = archive.migrations;
if (!Array.isArray(rows) || rows.length === 0) {
  throw new Error("Migration archive is empty or malformed");
}

for (const [index, row] of rows.entries()) {
  if (!/^\d{14}$/.test(row.version) || !row.name || typeof row.statement !== "string") {
    throw new Error(`Invalid migration at index ${index}`);
  }
  if (index > 0 && rows[index - 1].version >= row.version) {
    throw new Error(`Migration versions are not strictly ordered at ${row.version}`);
  }
  const actual = createHash("md5").update(row.statement, "utf8").digest("hex");
  if (actual !== row.statementMd5) {
    throw new Error(`Archived SQL hash differs for ${row.version}`);
  }
}

const historyIndex = process.argv.indexOf("--history");
if (historyIndex !== -1) {
  if (historyIndex !== 2 || process.argv.length !== 4) {
    throw new Error("Usage: node scripts/verify-applied-migration-archive.mjs [--history path]");
  }
  const lines = readFileSync(process.argv[3], "utf8").trimEnd().split("\n");
  if (lines.length !== rows.length) {
    throw new Error(`History has ${lines.length} rows; archive has ${rows.length}`);
  }
  for (const [index, line] of lines.entries()) {
    const [version, name, md5, extra] = line.replace(/\r$/, "").split("|");
    const row = rows[index];
    if (extra !== undefined || version !== row.version || name !== row.name || md5 !== row.statementMd5) {
      throw new Error(`Migration history differs at row ${index + 1}: ${version ?? ""}`);
    }
  }
}

console.log(`Verified ${rows.length} archived migration statements${historyIndex === -1 ? "" : " against database history"}.`);
