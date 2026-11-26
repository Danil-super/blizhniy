import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const { loadLocalPrimaryModule } = createRequire(import.meta.url)("../scripts/local-primary-modules.cjs");
const { parseMetricaCounterId, getMetricaCounterId } = loadLocalPrimaryModule("metrica-config");

test("Metrica accepts only positive safe integer counter IDs", () => {
  for (const value of [1, 135790246, Number.MAX_SAFE_INTEGER]) {
    assert.equal(parseMetricaCounterId(value), value);
    assert.equal(parseMetricaCounterId(String(value)), value);
    assert.equal(parseMetricaCounterId(`  ${value}  `), value);
  }
  for (const value of [undefined, null, true, false, {}, [], [135790246], 1n, NaN, Infinity, -Infinity,
    0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "", " ", "0", "-1", "+1", "01", "1.5", "1e6", "0x10",
    "1 2", "1\n2", "9007199254740992", "9".repeat(100), "https://mc.yandex.ru", "135790246;alert(1)",
    '135790246\"><script>', "１２３"]) {
    assert.equal(parseMetricaCounterId(value), null, `invalid counter ID type: ${typeof value}`);
  }
});

test("Metrica reads the current server runtime value and disables invalid or missing settings", () => {
  const previous = process.env.BLIZHNIY_YANDEX_METRICA_ID;
  try {
    process.env.BLIZHNIY_YANDEX_METRICA_ID = " 135790246 ";
    assert.equal(getMetricaCounterId(), 135790246);
    process.env.BLIZHNIY_YANDEX_METRICA_ID = "246801357";
    assert.equal(getMetricaCounterId(), 246801357);
    for (const value of ["", "not-a-counter", "135790246;script-src *", "9007199254740992"]) {
      process.env.BLIZHNIY_YANDEX_METRICA_ID = value;
      assert.equal(getMetricaCounterId(), null);
    }
    delete process.env.BLIZHNIY_YANDEX_METRICA_ID;
    assert.equal(getMetricaCounterId(), null);
  } finally {
    if (previous === undefined) delete process.env.BLIZHNIY_YANDEX_METRICA_ID;
    else process.env.BLIZHNIY_YANDEX_METRICA_ID = previous;
  }
});

test("Metrica browser configuration uses only response meta without stale environment fallback", () => {
  const previousDocument = globalThis.document;
  const previousId = process.env.BLIZHNIY_YANDEX_METRICA_ID;
  let content = " 246801357 ";
  process.env.BLIZHNIY_YANDEX_METRICA_ID = "135790246";
  globalThis.document = { querySelector: selector => {
    assert.equal(selector, 'meta[name="blizhniy-metrica-id"]');
    return content === null ? null : { getAttribute: name => {
      assert.equal(name, "content");
      return content;
    } };
  } };
  try {
    assert.equal(getMetricaCounterId(), 246801357);
    content = "357912468";
    assert.equal(getMetricaCounterId(), 357912468);
    for (const missing of ["", " ", null, "invalid", '135790246\"><script>']) {
      content = missing;
      assert.equal(getMetricaCounterId(), null);
    }
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousId === undefined) delete process.env.BLIZHNIY_YANDEX_METRICA_ID;
    else process.env.BLIZHNIY_YANDEX_METRICA_ID = previousId;
  }
});
