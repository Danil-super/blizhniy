import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HIGH_SEVERITY_SCORE = 7;

function sarifFiles(pathname) {
  const stat = statSync(pathname);
  if (stat.isFile()) return pathname.endsWith(".sarif") ? [pathname] : [];

  return readdirSync(pathname, { withFileTypes: true }).flatMap((entry) => {
    const child = `${pathname}/${entry.name}`;
    if (entry.isDirectory()) return sarifFiles(child);
    return entry.isFile() && entry.name.endsWith(".sarif") ? [child] : [];
  });
}

function securitySeverity(result, rule) {
  const raw = result.properties?.["security-severity"] ?? rule?.properties?.["security-severity"];
  const value = Number.parseFloat(String(raw ?? ""));
  return Number.isFinite(value) ? value : undefined;
}

export function collectBlockingFindings(report) {
  assert.ok(Array.isArray(report.runs) && report.runs.length > 0, "CodeQL SARIF has no runs");

  const blocking = [];
  let checked = 0;
  for (const run of report.runs) {
    assert.ok(Array.isArray(run.results), "CodeQL SARIF has no results list");
    const rules = new Map((run.tool?.driver?.rules ?? []).map((rule) => [rule.id, rule]));

    for (const result of run.results) {
      checked++;
      const rule = rules.get(result.ruleId);
      const level = result.level ?? rule?.defaultConfiguration?.level;
      const severity = securitySeverity(result, rule);
      if (level !== "error" && !(severity >= HIGH_SEVERITY_SCORE)) continue;

      const location = result.locations?.[0]?.physicalLocation;
      blocking.push({
        level: level ?? "unknown",
        ruleId: result.ruleId ?? "unknown-rule",
        severity,
        uri: location?.artifactLocation?.uri ?? "unknown",
        line: location?.region?.startLine ?? "?",
      });
    }
  }

  return { checked, blocking };
}

function formatFinding(finding) {
  const severity = finding.severity === undefined ? finding.level : `security severity ${finding.severity}`;
  return `${finding.ruleId} at ${finding.uri}:${finding.line} (${severity})`;
}

function main() {
  const reportPath = process.argv[2];
  assert.ok(reportPath, "Usage: node scripts/check-codeql-report.mjs <sarif-file-or-directory>");

  const files = sarifFiles(resolve(reportPath));
  assert.ok(files.length > 0, "CodeQL did not produce a SARIF report");

  const summary = files.reduce((total, file) => {
    const report = JSON.parse(readFileSync(file, "utf8"));
    const result = collectBlockingFindings(report);
    total.checked += result.checked;
    total.blocking.push(...result.blocking);
    return total;
  }, { checked: 0, blocking: [] });

  console.log(`CodeQL: ${summary.checked} findings reviewed, ${summary.blocking.length} blocking findings.`);
  if (summary.blocking.length) {
    console.error(summary.blocking.map(formatFinding).join("\n"));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
