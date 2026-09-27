import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/publication-time.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { effectivePublicationStatus } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const expiry = "2026-09-27T08:00:00.000Z";
const boundary = Date.parse(expiry);

test("published placement expires at the exact deadline", () => {
  assert.equal(effectivePublicationStatus("published", expiry, boundary - 1), "published");
  assert.equal(effectivePublicationStatus("published", expiry, boundary), "expired");
  assert.equal(effectivePublicationStatus("published", expiry, boundary + 1), "expired");
});

test("unrelated states and missing deadlines keep their stored value", () => {
  assert.equal(effectivePublicationStatus("archived", expiry, boundary + 1), "archived");
  assert.equal(effectivePublicationStatus("sold", expiry, boundary + 1), "sold");
  assert.equal(effectivePublicationStatus("pending_payment", expiry, boundary + 1), "pending_payment");
  assert.equal(effectivePublicationStatus("published", null, boundary + 1), "published");
  assert.equal(effectivePublicationStatus("published", "invalid", boundary + 1), "published");
});
