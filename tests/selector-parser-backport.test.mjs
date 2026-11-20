import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";

const projectRequire = createRequire(new URL("../package.json", import.meta.url));
const parserEntry = projectRequire.resolve("postcss-selector-parser");
const parser = projectRequire("postcss-selector-parser");
const certificate = JSON.parse(readFileSync(new URL("../docs/selector-upstream-6.1.5.json", import.meta.url), "utf8"));

// Each mutant restores exactly one vulnerable upstream pass in memory, only in
// its disposable child. Normal installed files and require caches are untouched.
const runtimeHunks = [
  {
    name: "deduplication",
    atom: ".a",
    replacements: [[
      "  return Array.from(new Set(Array.prototype.concat.apply([], arguments)));",
      "  var list = Array.prototype.concat.apply([], arguments);\n  return list.filter(function (item, i) {\n    return i === list.indexOf(item);\n  });",
    ]],
  },
  {
    name: "interpolation",
    atom: "#{a}",
    replacements: [
      ["      var interpolationIndexes = new Set(interpolations);\n", ""],
      ["return !interpolationIndexes.has(hashIndex);", "return !~interpolations.indexOf(hashIndex);"],
    ],
  },
  {
    name: "membership",
    atom: "#a",
    replacements: [
      ["    var classIndexes = new Set(hasClass);\n    var idIndexes = new Set(hasId);\n", ""],
      ["if (classIndexes.has(ind))", "if (~hasClass.indexOf(ind))"],
      ["if (idIndexes.has(ind))", "if (~hasId.indexOf(ind))"],
    ],
  },
];

// Maintainer regression, adapted to the repository's native Node test runner.
// https://github.com/postcss/postcss-selector-parser/blob/62b191792df0a0bc56062e5a875bc74aae2a51cd/src/__tests__/complexity.mjs
// A child-process bound contains the original CPU-exhaustion case. Both inputs
// contain the same atoms; the benign control does more AST work, not less.
const benchmarkSource = String.raw`
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { dirname, join } = require('node:path');
const [entry, atom, mutation, serializedHunks] = process.argv.slice(1);
if (mutation) {
  const hunk = JSON.parse(serializedHunks).find(hunk => hunk.name === mutation);
  assert.ok(hunk, 'Unknown mutation');
  const file = join(dirname(entry), 'parser.js');
  let source = readFileSync(file, 'utf8');
  for (const [patched, original] of hunk.replacements) {
    assert.equal(source.split(patched).length, 2, 'Expected one real patched hunk');
    source = source.replace(patched, original);
  }
  const replacement = { id: file, filename: file, exports: {}, loaded: true };
  new Function('require', 'module', 'exports', '__filename', '__dirname', source)(createRequire(file), replacement, replacement.exports, file, dirname(file));
  require.cache[file] = replacement;
}
const parser = require(entry);
assert.deepEqual(parser().astSync('.a.b').first.nodes.map(node => [node.type, node.value]), [['class', 'a'], ['class', 'b']]);
assert.deepEqual(parser().astSync('#x.y').first.nodes.map(node => [node.type, node.value]), [['id', 'x'], ['class', 'y']]);
const size = 60000;
function fastest(input) {
  let best = Infinity;
  for (let run = 0; run < 3; run++) {
    const start = process.hrtime.bigint();
    parser().astSync(input);
    best = Math.min(best, Number(process.hrtime.bigint() - start) / 1e6);
  }
  return best;
}
parser().astSync(atom.repeat(500));
parser().astSync((atom + ' ').repeat(500));
const hostileMs = fastest(atom.repeat(size));
const controlMs = fastest((atom + ' ').repeat(size));
console.log(JSON.stringify({ atom, mutation, size, hostileMs, controlMs, ratio: hostileMs / Math.max(controlMs, 1) }));
`;

function measure(atom, mutation = "") {
  const result = spawnSync(process.execPath, ["-e", benchmarkSource, parserEntry, atom, mutation, JSON.stringify(runtimeHunks)], {
    encoding: "utf8",
    env: { NODE_ENV: "test" },
    timeout: 25_000,
    maxBuffer: 64 * 1024,
  });
  assert.equal(result.status, 0, `Bounded selector benchmark failed: ${result.error?.message ?? ""}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

for (const { name, atom } of runtimeHunks) {
  test(`selector regression detects actual single-hunk ${name} rollback`, (context) => {
    const measured = measure(atom, name);
    context.diagnostic(JSON.stringify(measured));
    assert.ok(measured.ratio >= 2, `The ${name} mutant must violate the same complexity budget, not merely a source-text assertion`);
  });
}

test("installed selector manifest matches the official signed release and installation disables lifecycle scripts", () => {
  const bytes = readFileSync(join(dirname(dirname(parserEntry)), "package.json"));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), certificate.files["package.json"]);
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.name, certificate.package);
  assert.equal(manifest.version, certificate.version);
  assert.match(readFileSync(new URL("../.npmrc", import.meta.url), "utf8"), /^ignore-scripts=true$/m);
});

test("real Tailwind and postcss-nested resolve one installed official selector package", () => {
  for (const name of ["tailwindcss", "postcss-nested"]) {
    const consumerRequire = createRequire(projectRequire.resolve(`${name}/package.json`));
    assert.equal(consumerRequire.resolve("postcss-selector-parser"), parserEntry, name);
    assert.equal(consumerRequire("postcss-selector-parser"), parser, name);
  }
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  const entries = Object.entries(lock.packages).filter(([name]) => name.endsWith("/postcss-selector-parser"));
  assert.equal(entries.length, 1, "Both consumers must use the same verified registry package");
  assert.equal(entries[0][0], "node_modules/postcss-selector-parser");
  assert.equal(entries[0][1].resolved, certificate.tarball);
  assert.equal(entries[0][1].integrity, certificate.integrity);
  assert.equal(entries[0][1].dev, true);
  assert.equal(entries[0][1].version, certificate.version);
});

test("Tailwind selector mutation preserves class iteration, variants and pseudo-element placement", () => {
  const prefix = projectRequire("tailwindcss/lib/util/prefixSelector").default;
  const { finalizeSelector } = projectRequire("tailwindcss/lib/util/formatVariantSelector");
  assert.equal(prefix("tw-", ".foo.bar:hover"), ".tw-foo.tw-bar:hover");
  assert.equal(prefix("tw-", ".-mt-2", true), ".-tw-mt-2");
  const context = { tailwindConfig: { prefix: "" } };
  const formats = [{ format: "&:focus", respectPrefix: false }];
  for (const [input, expected] of [
    [".foo.bar:hover", ".focus\\:foo:focus.bar:hover"],
    [".bar.foo::before", ".focus\\:foo:focus.bar::before"],
    [".foo:is(.child,.other)", ".focus\\:foo:focus:is(.child,.other)"],
  ]) {
    assert.equal(finalizeSelector(input, formats, { context, candidate: "focus:foo" }), expected);
  }
});

test("actual Tailwind/PostCSS compiles prefixed variants, arbitrary values and apply directives", async () => {
  const postcss = projectRequire("postcss");
  const tailwind = projectRequire("tailwindcss");
  const compiled = await postcss([tailwind({
    content: [{ raw: "tw-block hover:tw-text-red-500 focus:tw-bg-[rgb(1,2,3)] group-hover:tw-underline", extension: "html" }],
    prefix: "tw-",
    corePlugins: { preflight: false },
  })]).process("@tailwind utilities; .card { @apply tw-block; }", { from: undefined });
  assert.match(compiled.css, /\.tw-block\s*\{\s*display: block/);
  assert.match(compiled.css, /\.hover\\:tw-text-red-500:hover/);
  assert.match(compiled.css, /\.tw-group:hover/);
  assert.match(compiled.css, /background-color: rgb\(1 2 3/);
  assert.match(compiled.css, /\.card\s*\{\s*display: block/);
  const nested = await postcss([projectRequire("postcss-nested")]).process(".card { &.active { color: red; } &:is(.a,.b) { color: blue; } }", { from: undefined });
  assert.match(nested.css, /\.card\.active\s*\{/);
  assert.match(nested.css, /\.card:is\(\.a,.b\)\s*\{/);
});

for (const [name, atom] of [["classes", ".a"], ["IDs", "#a"], ["Sass interpolation", "#{a}"]]) {
  test(`published selector complexity regression: flat ${name} remains proportional to its control`, (context) => {
    const measured = measure(atom);
    context.diagnostic(JSON.stringify(measured));
    assert.ok(measured.ratio < 2, `Hostile ${atom} cost ${measured.ratio.toFixed(2)}x its same-machine control`);
  });
}

test("published selector grammar keeps distinct leading class and ID nodes", () => {
  for (const [input, expected] of [
    [".a", [["class", "a"]]],
    [".a.b", [["class", "a"], ["class", "b"]]],
    ["#x.y", [["id", "x"], ["class", "y"]]],
  ]) {
    assert.deepEqual(parser().astSync(input).first.nodes.map((node) => [node.type, node.value]), expected);
  }
});

test("published selector grammar preserves every class in a large flat AST", () => {
  const nodes = parser().astSync(".a".repeat(20_000)).first.nodes;
  assert.equal(nodes.length, 20_000);
  assert.ok(nodes.every((node) => node.type === "class" && node.value === "a"));
});

test("published selector grammar preserves escapes, attributes, combinators, pseudos and Sass", () => {
  for (const input of [
    ".hover\\:bg-red-500:hover",
    "svg|a.icon > .child + #target ~ *",
    ':is(.a, #x):not([hidden]) > [data-label="hello world" i]::before',
    "&.button#{suffix}",
    ".a/* retained comment */.b",
    "12.5%",
  ]) {
    assert.equal(parser().astSync(input).toString(), input);
    assert.equal(parser().processSync(input), input);
  }
});
