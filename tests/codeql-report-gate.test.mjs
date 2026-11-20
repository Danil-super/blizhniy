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

function extensionReport() {
  const input = report([{
    ruleId: "js/shared",
    rule: { id: "js/shared", index: 0, toolComponent: { index: 1 } },
  }], [{ id: "js/shared", defaultConfiguration: { level: "note" } }]);
  input.runs[0].tool.extensions = [{ name: "diff", rules: [] }, {
    name: "queries",
    rules: [{ id: "js/shared", properties: { "security-severity": "7.8" } }],
  }];
  return input;
}

test("CodeQL resolves rule scores from the referenced extension", () => {
  const input = extensionReport();
  assert.deepEqual(collectBlockingFindings(input).blocking.map(finding => finding.severity), [7.8]);
  input.runs[0].results[0].rule.toolComponent = { name: "queries" };
  delete input.runs[0].results[0].rule.index;
  assert.equal(collectBlockingFindings(input).blocking.length, 1);
});

test("CodeQL blocks a referenced extension error with no score", () => {
  const input = extensionReport();
  input.runs[0].tool.extensions[1].rules[0] = { id: "js/shared", defaultConfiguration: { level: "error" } };
  assert.equal(collectBlockingFindings(input).blocking[0].level, "error");
});

test("CodeQL rejects broken references instead of silently allowing the finding", () => {
  for (const change of [
    result => { result.rule.toolComponent.index = 2; },
    result => { result.rule.index = 1; },
    result => { result.rule.index = "0"; },
    result => { result.rule.toolComponent.name = "other"; },
    result => { result.rule.id = "js/other"; },
    result => { result.rule.toolComponent = { name: "unknown" }; },
  ]) {
    const input = extensionReport();
    change(input.runs[0].results[0]);
    assert.throws(() => collectBlockingFindings(input));
  }
});
