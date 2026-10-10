import { spawn } from "node:child_process";
import { constants, type BigIntStats } from "node:fs";
import { open, realpath, type FileHandle } from "node:fs/promises";
import { isAbsolute, resolve, join } from "node:path";
import type { MediaFileRecord } from "./media-files";
import { encodeFileWrite } from "./media-file-protocol.ts";

type WorkerCode = "INVALID_MEDIA_FILE_WRITE" | "MEDIA_FILE_WORKER_BUSY" | "MEDIA_FILE_WORKER_UNAVAILABLE";
export class MediaFileWorkerError extends Error {
  readonly code: WorkerCode;
  constructor(code: WorkerCode) { super("Media file worker failed"); this.name = "MediaFileWorkerError"; this.code = code; }
}
const unavailable = () => new MediaFileWorkerError("MEDIA_FILE_WORKER_UNAVAILABLE");
const runtime = globalThis as typeof globalThis & { __blizhniyFileWorker?: { busy: boolean; disabled: boolean } };
const state = runtime.__blizhniyFileWorker ??= { busy: false, disabled: false };
const same = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino;

/** Trusted local configuration only. No SQL authority, retry, cleanup or production upload. */
export async function createLocalMediaFileWorker(appDirectory: string, rootDirectory: string) {
  const check = () => {
    if (typeof window !== "undefined" || process.platform !== "linux" || Number(process.versions.node.split(".")[0]) !== 22 ||
        !["development", "test"].includes(process.env.NODE_ENV ?? "") || state.disabled ||
        [appDirectory, rootDirectory].some(value => typeof value !== "string" || !isAbsolute(value) || resolve(value) !== value || value === "/")) throw unavailable();
  };
  let rootIdentity: BigIntStats | undefined, lockIdentity: BigIntStats | undefined;
  const close = async (file?: FileHandle) => { await file?.close().catch(() => { state.disabled = true; throw unavailable(); }); };
  const acquireDescriptors = async () => {
    check(); let directory: FileHandle | undefined, lock: FileHandle | undefined;
    try {
      directory = await open(rootDirectory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      const root = await directory.stat({ bigint: true }), anchor = `/proc/self/fd/${directory.fd}`;
      if (!root.isDirectory() || root.uid !== BigInt(process.getuid!()) || (root.mode & BigInt(0o7777)) !== BigInt(0o700) ||
          (rootIdentity && !same(rootIdentity, root)) || await realpath(anchor) !== rootDirectory) throw unavailable();
      lock = await open(`${anchor}/.writer.lock`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const info = await lock.stat({ bigint: true });
      if (!info.isFile() || info.uid !== root.uid || (info.mode & BigInt(0o7777)) !== BigInt(0o600) || info.nlink !== BigInt(1) || info.size !== BigInt(0) ||
          (lockIdentity && !same(lockIdentity, info))) throw unavailable();
      rootIdentity ??= root; lockIdentity ??= info;
      return { directory, lock };
    } catch { try { await close(lock); } finally { await close(directory); } throw unavailable(); }
  };
  const initial = await acquireDescriptors(); try { await close(initial.lock); } finally { await close(initial.directory); }
  return {
    async write(record: MediaFileRecord, bytes: Uint8Array, attemptId: string, signal?: AbortSignal): Promise<void> {
      check(); let frame: Buffer;
      try { frame = encodeFileWrite(record, bytes, attemptId); } catch { throw new MediaFileWorkerError("INVALID_MEDIA_FILE_WRITE"); }
      if (signal?.aborted) throw unavailable();
      if (state.busy) throw new MediaFileWorkerError("MEDIA_FILE_WORKER_BUSY");
      state.busy = true; let handles: Awaited<ReturnType<typeof acquireDescriptors>> | undefined;
      try {
        handles = await acquireDescriptors(); if (signal?.aborted) throw unavailable();
        const child = spawn("/usr/bin/flock", ["--no-fork", "--exclusive", "--nonblock", "--conflict-exit-code=73", "/proc/self/fd/3",
          process.execPath, "--experimental-strip-types", "--no-warnings", "--max-old-space-size=64", join(appDirectory, "scripts/media-file-worker.mjs"), rootDirectory,
        ], { env: { NODE_ENV: "test", LANG: "C", UV_THREADPOOL_SIZE: "2" }, shell: false, stdio: ["pipe", "pipe", "ignore", handles.lock.fd, handles.directory.fd] });
        // Extra inherited FDs select Node's general overload; fd 0/1 are fixed pipes above.
        const stdin = child.stdin!, stdout = child.stdout!;
        await new Promise<void>((accept, reject) => {
          let reply = Buffer.alloc(0), stopping = false, finished = false, exited = false;
          let stopDeadline: ReturnType<typeof setTimeout> | undefined;
          const finish = (error?: MediaFileWorkerError) => {
            if (finished) return; finished = true; clearTimeout(deadline); clearTimeout(stopDeadline); signal?.removeEventListener("abort", stop);
            stdin.destroy(); stdout.destroy(); if (error) reject(error); else accept();
          };
          const stop = () => {
            if (finished || stopping) return; stopping = true;
            // Signal delivery is not proof: retain capacity until close, or latch permanently.
            stopDeadline = setTimeout(() => { state.disabled = true; finish(unavailable()); }, 2000);
            try { if (!exited && child.pid && !child.kill("SIGKILL")) state.disabled = true; } catch { state.disabled = true; }
          };
          const deadline = setTimeout(stop, 5000);
          signal?.addEventListener("abort", stop, { once: true });
          child.on("exit", () => { exited = true; });
          child.on("error", () => { if (child.pid) stop(); });
          stdin.on("error", () => { /* EPIPE can mean immediate lock conflict; wait for close. */ });
          stdout.on("error", stop);
          stdout.on("data", (chunk: Buffer) => { if (finished || stopping) return; if (reply.length + chunk.length > 1) { stop(); return; } reply = Buffer.concat([reply, chunk]); });
          child.on("close", code => {
            if (finished) return;
            if (!stopping && code === 73 && reply.length === 0) { finish(new MediaFileWorkerError("MEDIA_FILE_WORKER_BUSY")); return; }
            if (!stopping && code === 0 && reply.length === 1 && reply[0] === 0) { finish(); return; }
            state.disabled = true; finish(unavailable());
          });
          if (signal?.aborted) stop();
          stdin.end(frame);
        });
      } catch (error) { if (error instanceof MediaFileWorkerError) throw error; throw unavailable(); }
      finally { try { await close(handles?.lock); } finally { try { await close(handles?.directory); } finally { state.busy = false; } } }
    },
  };
}
