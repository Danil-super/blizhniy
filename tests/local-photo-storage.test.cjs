const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function fixture() {
  const transactions = [];
  const source = readFileSync(join(__dirname, "../src/lib/client-media-store.ts"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022} }).outputText;
  const exports = {};
  const database = {
    transaction() {
      const records = [];
      const tx = { records, objectStore: () => ({ add(record) { records.push(record); } }), abort() {} };
      transactions.push(tx);
      return tx;
    },
  };
  const indexedDB = {open() {
    const request = {result: database};
    queueMicrotask(() => request.onsuccess());
    return request;
  }};
  new Function("exports", "require", "window", js)(exports, id => {
    assert.equal(id, "./image-data-url");
    return {};
  }, {indexedDB});
  return {exports, transactions, indexedDB};
}

function photos() {
  const data = new FormData();
  data.set("photos", new File(["a"], "cover.webp", {type:"image/webp"}));
  data.append("photos", new File(["b"], "second.webp", {type:"image/webp"}));
  data.set("existingPhotos", "listings/owner/old.webp");
  data.set("localPhotoOrder", "new,saved,new");
  return data;
}

test("all new photos commit together before the form receives its ordered references", async () => {
  const h = fixture();
  const form = photos();
  const first = h.exports.storeFormPhotos(form, 3);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.transactions.length, 1);
  const [transaction] = h.transactions;
  assert.deepEqual(transaction.records.map(record => record.name), ["cover.webp", "second.webp"]);
  transaction.error = new DOMException("full", "QuotaExceededError");
  transaction.onabort();
  await assert.rejects(first, /недостаточно места/);
  const retry = h.exports.storeFormPhotos(form, 3);
  await new Promise(resolve => setImmediate(resolve));
  const second = h.transactions[1];
  second.oncomplete();
  assert.deepEqual(await retry, [second.records[0].id, form.get("existingPhotos"), second.records[1].id]);
});

test("incomplete or preparing selections stop the draft before opening storage", async () => {
  const h = fixture();
  const data = photos();
  data.set("photosPreparing", "1");
  await assert.rejects(h.exports.storeFormPhotos(data, 3), /подготовки/);
  data.delete("photosPreparing");
  data.set("localPhotoOrder", "new,saved");
  await assert.rejects(h.exports.storeFormPhotos(data, 3), /Список фотографий/);
  data.delete("photos");
  data.delete("localPhotoOrder");
  assert.deepEqual(await h.exports.storeFormPhotos(data, 3), [data.get("existingPhotos")]);
  assert.deepEqual(h.transactions, []);
});

test("retrying the same file can reopen IndexedDB after a transient open failure", async () => {
  const h = fixture();
  const open = h.indexedDB.open;
  h.indexedDB.open = () => { throw new DOMException("storage unavailable", "UnknownError"); };
  const file = photos().get("photos");
  await assert.rejects(h.exports.storeMediaFile(file), /Не удалось сохранить/);
  h.indexedDB.open = open;
  const retry = h.exports.storeMediaFile(file);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.transactions.length, 1);
  h.transactions[0].oncomplete();
  assert.equal(await retry, h.transactions[0].records[0].id);
});
