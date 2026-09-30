import assert from "node:assert/strict";
import { test } from "node:test";
import { collectBlockingFindings } from "../scripts/check-codeql-report.mjs";

function report(results, rules = []) {
  return {
    runs: [{
      results,
      tool: { driver: { rules } },
    }],
  };
}

test("CodeQL gate permits low and medium findings but blocks high severity", () => {
  const result = collectBlockingFindings(report([
    { ruleId: "js/medium", level: "warning", properties: { "security-severity": "6.4" } },
    { ruleId: "js/high", level: "warning", properties: { "security-severity": "7.0" } },
  ]));

  assert.equal(result.checked, 2);
  assert.deepEqual(result.blocking.map((finding) => finding.ruleId), ["js/high"]);
});

test("CodeQL gate blocks an error even when security severity is absent", () => {
  const result = collectBlockingFindings(report([
    { ruleId: "js/error", level: "error", locations: [{ physicalLocation: { artifactLocation: { uri: "src/app.ts" }, region: { startLine: 42 } } }] },
  ]));

  assert.deepEqual(result.blocking, [{
    ruleId: "js/error",
    level: "error",
    severity: undefined,
    uri: "src/app.ts",
    line: 42,
  }]);
});

test("CodeQL gate reads severity from SARIF rule metadata", () => {
  const result = collectBlockingFindings(report(
    [{ ruleId: "js/rule-severity", level: "warning" }],
    [{ id: "js/rule-severity", properties: { "security-severity": "8.2" } }],
  ));

  assert.equal(result.blocking.length, 1);
  assert.equal(result.blocking[0].severity, 8.2);
});
