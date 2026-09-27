import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const reportPath = process.argv[2];
assert.ok(reportPath, "Usage: node scripts/check-semgrep-report.mjs <report.sarif>");

const report = JSON.parse(readFileSync(reportPath, "utf8"));
assert.ok(Array.isArray(report.runs) && report.runs.length > 0, "Semgrep SARIF has no runs");

let checked = 0;
const severe = [];
for (const run of report.runs) {
  assert.ok(Array.isArray(run.results), "Semgrep SARIF has no results list");
  const rules = new Map((run.tool?.driver?.rules ?? []).map((rule) => [rule.id, rule]));

  for (const result of run.results) {
    checked++;
    const level = result.level ?? rules.get(result.ruleId)?.defaultConfiguration?.level;
    if (level === "error") {
      const location = result.locations?.[0]?.physicalLocation;
      severe.push(`${result.ruleId} at ${location?.artifactLocation?.uri ?? "unknown"}:${location?.region?.startLine ?? "?"}`);
    }
  }
}

console.log(`Semgrep: ${checked} findings reviewed, ${severe.length} severe findings.`);
if (severe.length) {
  console.error(severe.join("\n"));
  process.exitCode = 1;
}
