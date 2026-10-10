import { fstatSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { createLocalMediaFileStore } from "../src/lib/media-files.ts";
import { decodeFileWrite, FILE_WRITE_MAX_BYTES } from "../src/lib/media-file-protocol.ts";
import { decodeFileInspection, encodeFileObservation, FILE_INSPECT_REQUEST_BYTES } from "../src/lib/media-file-inspection-protocol.ts";

const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
export function assertFileFence(root) {
  if (process.platform !== "linux" || process.env.NODE_ENV !== "test" || Number(process.versions.node.split(".")[0]) !== 22 ||
      typeof root !== "string" || !isAbsolute(root) || resolve(root) !== root || root === "/") throw new Error("File fence unavailable");
  const directory = fstatSync(4, { bigint: true }), lock = fstatSync(3, { bigint: true });
  if (!directory.isDirectory() || directory.uid !== BigInt(process.getuid()) || (directory.mode & BigInt(0o7777)) !== BigInt(0o700) || realpathSync("/proc/self/fd/4") !== root ||
      !lock.isFile() || lock.uid !== directory.uid || (lock.mode & BigInt(0o7777)) !== BigInt(0o600) || lock.nlink !== BigInt(1) || lock.size !== BigInt(0) ||
      !same(lock, lstatSync("/proc/self/fd/4/.writer.lock", { bigint: true }))) throw new Error("File fence unavailable");
  // flock opens a separate OFD through fd 3, then execs Node with that locked FD intact.
  const descriptors = readdirSync("/proc/self/fd"); if (descriptors.length > 128) throw new Error("File fence unavailable");
  const held = descriptors.some(fd => {
    try {
      if (!/^\d+$/.test(fd) || !same(lock, fstatSync(Number(fd), { bigint: true }))) return false;
      return new RegExp(`^lock:\\s+\\d+: FLOCK\\s+ADVISORY\\s+WRITE\\s+${process.pid}\\s+\\S+:${lock.ino} 0 EOF$`, "m").test(readFileSync(`/proc/self/fdinfo/${fd}`, "utf8"));
    } catch { return false; }
  });
  if (!held) throw new Error("File fence unavailable");
  return directory;
}

export async function runFileWorker(createStore = createLocalMediaFileStore, mode = "write") {
  if (!["write", "inspect", "observe"].includes(mode)) throw new Error("File operation unavailable");
  const root = process.argv[2], proof = assertFileFence(root);
  if (mode === "observe") {
    process.stdout.write(Buffer.from([82])); // READY only after this process proves its kernel fence.
    let frame = Buffer.alloc(0), observed = false, chunks = 0;
    for await (const chunk of process.stdin) {
      if (++chunks > 256 || observed || frame.length + chunk.length > FILE_INSPECT_REQUEST_BYTES) throw new Error("File observation unavailable");
      frame = Buffer.concat([frame, chunk]);
      if (frame.length === FILE_INSPECT_REQUEST_BYTES) {
        const { record, attemptId } = decodeFileInspection(frame);
        if (!same(proof, assertFileFence(root))) throw new Error("File fence unavailable");
        const report = await (await createStore(root, proof)).inspect(record, attemptId);
        if (!same(proof, assertFileFence(root))) throw new Error("File fence unavailable");
        observed = true; process.stdout.write(encodeFileObservation(report));
      }
    }
    // EOF is sent only after the parent's guarded transaction has settled.
    if ((frame.length !== 0 && !observed) || !same(proof, assertFileFence(root))) throw new Error("File observation unavailable");
    return Buffer.from([68]); // DONE, including denied/no-request observations.
  }
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length; if (size > (mode === "write" ? FILE_WRITE_MAX_BYTES : FILE_INSPECT_REQUEST_BYTES) || chunks.length >= 256) throw new Error("File operation unavailable"); chunks.push(chunk);
  }
  if (mode === "inspect") {
    const { record, attemptId } = decodeFileInspection(Buffer.concat(chunks, size));
    if (!same(proof, assertFileFence(root))) throw new Error("File fence unavailable");
    const observation = await (await createStore(root, proof)).inspect(record, attemptId);
    if (!same(proof, assertFileFence(root))) throw new Error("File fence unavailable");
    return encodeFileObservation(observation);
  }
  const { record, bytes, attemptId } = decodeFileWrite(Buffer.concat(chunks, size));
  if (!same(proof, assertFileFence(root))) throw new Error("File fence unavailable");
  await (await createStore(root, proof)).write(record, bytes, attemptId);
}
