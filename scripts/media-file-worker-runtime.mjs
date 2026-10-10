import { fstatSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { createLocalMediaFileStore } from "../src/lib/media-files.ts";
import { decodeFileWrite, FILE_WRITE_MAX_BYTES } from "../src/lib/media-file-protocol.ts";

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

export async function runFileWorker(createStore = createLocalMediaFileStore) {
  const root = process.argv[2], proof = assertFileFence(root);
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length; if (size > FILE_WRITE_MAX_BYTES || chunks.length >= 256) throw new Error("File write unavailable"); chunks.push(chunk);
  }
  const { record, bytes, attemptId } = decodeFileWrite(Buffer.concat(chunks, size));
  if (!same(proof, assertFileFence(root))) throw new Error("File fence unavailable");
  await (await createStore(root, proof)).write(record, bytes, attemptId);
}
