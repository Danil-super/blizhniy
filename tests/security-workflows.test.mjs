import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("..", import.meta.url);

function read(relativePath) {
  return readFileSync(new URL(relativePath, root), "utf8");
}

test("production deploy waits for every blocking security gate", () => {
  const deploy = read(".github/workflows/deploy.yml");

  assert.match(deploy, /security:\s*\n\s+uses: \.\/\.github\/workflows\/security-checks\.yml/);
  assert.match(deploy, /codeql:\s*\n\s+uses: \.\/\.github\/workflows\/codeql\.yml/);
  assert.match(
    deploy,
    /deploy:\s*\n\s+needs: \[validate, security, codeql\]/,
    "VPS deployment must wait for application tests, scanner checks and CodeQL",
  );
});

test("CodeQL covers TypeScript changes on pull requests, production releases and a schedule", () => {
  const codeql = read(".github/workflows/codeql.yml");

  assert.match(codeql, /^name: CodeQL$/m);
  assert.match(codeql, /workflow_call:/);
  assert.match(codeql, /pull_request:\s*\n\s+branches:\s*\n\s+- main/);
  assert.match(codeql, /schedule:\s*\n(?:\s*#.*\n)*\s+- cron:/);
  assert.match(codeql, /language: \[javascript-typescript\]/);
  assert.match(codeql, /build-mode: none/);
  assert.match(codeql, /queries: \+security-extended/);
  assert.match(codeql, /github\/codeql-action\/init@[0-9a-f]{40}/);
  assert.match(codeql, /github\/codeql-action\/analyze@[0-9a-f]{40}/);
});

test("dependency, secrets and static-analysis failures remain release blockers", () => {
  const ci = read(".github/workflows/ci.yml");
  const security = read(".github/workflows/security-checks.yml");
  const dependencyReview = read(".github/workflows/dependency-review.yml");
  const dependabot = read(".github/dependabot.yml");

  assert.match(ci, /npm audit --omit=dev --audit-level=high/);
  assert.match(security, /fetch-depth: 0/);
  assert.match(security, /Scan secrets with Gitleaks/);
  assert.match(security, /Scan code with Semgrep/);
  assert.match(security, /Scan dependencies and config with Trivy/);
  assert.match(security, /Fail on security findings or scanner errors/);
  assert.match(dependencyReview, /actions\/dependency-review-action@[0-9a-f]{40}/);
  assert.match(dependencyReview, /fail-on-severity: high/);
  assert.match(dependencyReview, /fail-on-scopes: runtime, development, unknown/);
  assert.match(dependabot, /package-ecosystem: npm/);
  assert.match(dependabot, /package-ecosystem: github-actions/);
});

test("all third-party GitHub Actions are pinned to immutable commit SHAs", () => {
  const workflowsDirectory = new URL(".github/workflows/", root);
  const workflowNames = readdirSync(workflowsDirectory).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));

  for (const workflowName of workflowNames) {
    const contents = read(`.github/workflows/${workflowName}`);
    const references = [...contents.matchAll(/^\s*uses:\s+([^\s#]+)(?:\s|#|$)/gm)].map((match) => match[1]);

    for (const reference of references) {
      if (reference.startsWith("./")) continue;

      const at = reference.lastIndexOf("@");
      assert.ok(at > 0, `${workflowName}: ${reference} must include an immutable reference`);
      assert.match(reference.slice(at + 1), /^[0-9a-f]{40}$/i, `${workflowName}: ${reference} must use a full commit SHA`);
    }
  }
});
