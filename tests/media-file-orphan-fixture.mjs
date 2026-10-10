// Test-owned parent. Killing it must not release the actual writer's kernel lock.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileWorkerModule } from "./media-file-worker-module.mjs";
import { decodeFileWrite, FILE_WRITE_MAX_BYTES } from "../src/lib/media-file-protocol.ts";

if (process.env.NODE_ENV !== "test") throw new Error("Test fixture required");
const [appRoot, root] = process.argv.slice(2), chunks = []; let size = 0;
for await (const chunk of process.stdin) { size += chunk.length; if (size > FILE_WRITE_MAX_BYTES) throw new Error("Test input bound exceeded"); chunks.push(chunk); }
const { record, bytes, attemptId } = decodeFileWrite(Buffer.concat(chunks, size));
const module = fileWorkerModule({ childProcess: { spawn: (command, args, options) => spawn(command,
  Array.from(args, arg => arg === path.join(appRoot, "scripts/media-file-worker.mjs") ? path.join(appRoot, "tests/media-file-worker-fault.mjs") : arg), options) } });
await (await module.createLocalMediaFileWorker(appRoot, root)).write(record, bytes, attemptId);
