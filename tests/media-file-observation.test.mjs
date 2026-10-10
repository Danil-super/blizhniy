import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { fileWorkerModule } from "./media-file-worker-module.mjs";

const appRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const bytes = Buffer.from("524946460400000057454250", "hex");
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(tmpdir(), "blizhniy-file-observation-")), proof = await fs.lstat(root, { bigint: true });
  await fs.writeFile(path.join(root, ".writer.lock"), "", { flag: "wx", mode: 0o600 });
  t.after(async () => {
    const current = await fs.lstat(root, { bigint: true }); assert.equal(current.dev, proof.dev); assert.equal(current.ino, proof.ino);
    assert.equal(current.uid, BigInt(process.getuid())); assert.ok(current.isDirectory()); assert.ok(path.basename(root).startsWith("blizhniy-file-observation-"));
    await fs.rm(root, { recursive: true });
  });
  const record = { id: randomUUID(), mimeType: "image/webp", width: 1, height: 1, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  const worker = await fileWorkerModule().createLocalMediaFileWorker(appRoot, root);
  return { root, worker, record, attemptId: randomUUID() };
}
test("actual observer retains the kernel fence after report until its guarded callback settles", async t => {
  const f = await fixture(t), separateParent = await fileWorkerModule().createLocalMediaFileWorker(appRoot, f.root); let saved;
  const result = await f.worker.observe(async inspect => {
    saved = inspect;
    const report = await inspect(f.record, f.attemptId);
    assert.deepEqual(report, { final: "absent", temporary: "absent", linked: false });
    await assert.rejects(separateParent.write(f.record, bytes, randomUUID()), { code: "MEDIA_FILE_WORKER_BUSY" });
    return report;
  });
  assert.deepEqual(result, { final: "absent", temporary: "absent", linked: false });
  await assert.rejects(saved(f.record, f.attemptId), { code: "MEDIA_FILE_WORKER_UNAVAILABLE" });
  await separateParent.write(f.record, bytes, randomUUID());
});
test("actual owner denial sends no inspection request, cleanly closes, and does not disable later jobs", async t => {
  const f = await fixture(t), denied = new Error("Synthetic owner denial");
  await assert.rejects(f.worker.observe(async () => { throw denied; }), error => error === denied);
  assert.deepEqual(await fs.readdir(f.root), [".writer.lock"]);
  assert.deepEqual(await f.worker.inspect(f.record, f.attemptId), { final: "absent", temporary: "absent", linked: false });
});
