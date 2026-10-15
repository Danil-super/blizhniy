import { spawn } from "node:child_process";
import { constants, type BigIntStats } from "node:fs";
import { open, realpath, type FileHandle } from "node:fs/promises";
import { isAbsolute, resolve, join } from "node:path";
import type { MediaFileRecord, MediaFileObservation } from "./media-files";
import { encodeFileWrite } from "./media-file-protocol.ts";
import { encodeFileInspection, decodeFileObservation, FILE_INSPECT_REPLY_BYTES } from "./media-file-inspection-protocol.ts";
import { assertMediaRuntime } from "./media-runtime-policy.ts";

type WorkerCode = "INVALID_MEDIA_FILE_WRITE" | "INVALID_MEDIA_FILE_INSPECTION" | "MEDIA_FILE_WORKER_BUSY" | "MEDIA_FILE_WORKER_UNAVAILABLE";
export class MediaFileWorkerError extends Error {
  readonly code: WorkerCode;
  constructor(code: WorkerCode) { super("Media file worker failed"); this.name = "MediaFileWorkerError"; this.code = code; }
}
const unavailable = () => new MediaFileWorkerError("MEDIA_FILE_WORKER_UNAVAILABLE");
const runtime = globalThis as typeof globalThis & { __blizhniyFileWorker?: { busy: boolean; disabled: boolean } };
const state = runtime.__blizhniyFileWorker ??= { busy: false, disabled: false };
const same = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino;
export type MediaFileInspector = (record: MediaFileRecord, attemptId: string) => Promise<MediaFileObservation>;
type FileJob = { mode: "write" | "inspect"; frame: Buffer };
type ObservationJob<T> = { mode: "observe"; work: (inspect: MediaFileInspector) => Promise<T> };

/** Trusted local configuration only. No SQL authority, retry, cleanup or production upload. */
export async function createLocalMediaFileWorker(appDirectory: string, rootDirectory: string) {
  const check = () => {
    try { assertMediaRuntime(process, rootDirectory, appDirectory); } catch { throw unavailable(); }
    if (typeof window !== "undefined" || process.platform !== "linux" || Number(process.versions.node.split(".")[0]) !== 22 ||
        state.disabled ||
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
  async function execute(job: FileJob, signal?: AbortSignal): Promise<Buffer>;
  async function execute<T>(job: ObservationJob<T>, signal?: AbortSignal): Promise<T>;
  async function execute(job: FileJob | ObservationJob<unknown>, signal?: AbortSignal): Promise<unknown> {
      const mode = job.mode;
      check();
      if (signal?.aborted) throw unavailable();
      if (state.busy) throw new MediaFileWorkerError("MEDIA_FILE_WORKER_BUSY");
      state.busy = true; let handles: Awaited<ReturnType<typeof acquireDescriptors>> | undefined;
      let workRejection: { error: unknown } | undefined;
      try {
        handles = await acquireDescriptors(); if (signal?.aborted) throw unavailable();
        const child = spawn("/usr/bin/flock", ["--no-fork", "--exclusive", "--nonblock", "--conflict-exit-code=73", "/proc/self/fd/3",
          process.execPath, "--experimental-strip-types", "--no-warnings", "--max-old-space-size=64", join(appDirectory, "scripts/media-file-worker.mjs"), rootDirectory, mode,
        ], { env: { NODE_ENV: process.env.NODE_ENV === "production" ? "production" : "test", LANG: "C", UV_THREADPOOL_SIZE: "2",
          ...(process.env.NODE_ENV === "production" ? { BLIZHNIY_AUTH_MODE: "postgres" } : {}) },
          shell: false, stdio: ["pipe", "pipe", "ignore", handles.lock.fd, handles.directory.fd] });
        // Extra inherited FDs select Node's general overload; fd 0/1 are fixed pipes above.
        const stdin = child.stdin!, stdout = child.stdout!;
        return await new Promise<unknown>((accept, reject) => {
          let reply = Buffer.alloc(0), stopping = false, finished = false, exited = false;
          let started = false, workFinished = false, workFailed = false, workResult: unknown, workError: unknown;
          let requested = false, inspected = false;
          let inspectResolve: ((value: MediaFileObservation) => void) | undefined, inspectReject: ((error: Error) => void) | undefined;
          let stopDeadline: ReturnType<typeof setTimeout> | undefined;
          const finish = (error?: MediaFileWorkerError) => {
            if (finished) return; finished = true; clearTimeout(deadline); clearTimeout(stopDeadline); signal?.removeEventListener("abort", stop);
            stdin.destroy(); stdout.destroy(); inspectReject?.(unavailable());
            if (error) reject(error); else if (mode === "observe" && workFailed) reject(workError); else accept(mode === "observe" ? workResult : reply);
          };
          const stop = () => {
            if (finished || stopping) return; stopping = true;
            // Signal delivery is not proof: retain capacity until close, or latch permanently.
            stopDeadline = setTimeout(() => { state.disabled = true; finish(unavailable()); }, 2000);
            try { if (!exited && child.pid && !child.kill("SIGKILL")) state.disabled = true; } catch { state.disabled = true; }
          };
          const deadline = setTimeout(stop, 5000);
          const finishWork = (failed: boolean, value: unknown) => {
            if (finished || stopping || exited) return;
            workFinished = true; workFailed = failed; if (failed) { workError = value; workRejection = { error: value }; } else workResult = value;
            // A callback must await its one observation; no detached work or later reuse.
            if (requested && !inspected) { stop(); return; }
            stdin.end();
          };
          const startWork = () => {
            if (job.mode !== "observe" || started) return;
            started = true;
            const inspect: MediaFileInspector = (record, attemptId) => {
              const pending = (async () => {
                if (finished || stopping || exited || workFinished || requested) throw unavailable();
                let frame: Buffer;
                try { frame = encodeFileInspection(record, attemptId); } catch { throw new MediaFileWorkerError("INVALID_MEDIA_FILE_INSPECTION"); }
                requested = true;
                return new Promise<MediaFileObservation>((resolve, reject) => {
                  inspectResolve = resolve; inspectReject = reject; stdin.write(frame);
                });
              })();
              // Misused detached work must not escape supervisor failure handling.
              pending.catch(() => {}); return pending;
            };
            Promise.resolve().then(() => {
              if (finished || stopping || exited) throw unavailable();
              return job.work(inspect);
            }).then(value => finishWork(false, value), error => finishWork(true, error));
          };
          signal?.addEventListener("abort", stop, { once: true });
          child.on("exit", () => { exited = true; });
          child.on("error", () => { if (child.pid) stop(); });
          stdin.on("error", () => { /* EPIPE can mean immediate lock conflict; wait for close. */ });
          stdout.on("error", stop);
          stdout.on("data", (chunk: Buffer) => {
            if (finished || stopping) return;
            if (reply.length + chunk.length > (mode === "write" ? 1 : mode === "inspect" ? FILE_INSPECT_REPLY_BYTES : 9)) { stop(); return; }
            reply = Buffer.concat([reply, chunk]);
            if (mode !== "observe") return;
            if (reply[0] !== 82) { stop(); return; }
            startWork();
            if ((!requested && reply.length > 1 && (!workFinished || reply.length !== 2 || reply[1] !== 68)) ||
                (requested && reply.length > 8 && !workFinished)) { stop(); return; }
            if (requested && !inspected && reply.length >= 8) {
              try { const report = decodeFileObservation(reply.subarray(1, 8)); inspected = true; inspectResolve?.(report); }
              catch { stop(); }
            }
          });
          child.on("close", code => {
            if (finished) return;
            if (!stopping && code === 73 && reply.length === 0) { finish(new MediaFileWorkerError("MEDIA_FILE_WORKER_BUSY")); return; }
            if (!stopping && code === 0) {
              try {
                if (mode === "observe") {
                  if (!started || !workFinished || reply.length !== (requested ? 9 : 2) || reply[0] !== 82 || reply.at(-1) !== 68 || (requested && !inspected)) throw unavailable();
                } else if (mode === "inspect") decodeFileObservation(reply);
                else if (reply.length !== 1 || reply[0] !== 0) throw unavailable();
                finish(); return;
              } catch { /* Invalid reply is UNKNOWN, not successful observation. */ }
            }
            state.disabled = true; finish(unavailable());
          });
          if (signal?.aborted) stop();
          if (job.mode !== "observe") stdin.end(job.frame);
        });
      } catch (error) { if (error instanceof MediaFileWorkerError || (workRejection && error === workRejection.error)) throw error; throw unavailable(); }
      finally { try { await close(handles?.lock); } finally { try { await close(handles?.directory); } finally { state.busy = false; } } }
  }
  return {
    async write(record: MediaFileRecord, bytes: Uint8Array, attemptId: string, signal?: AbortSignal): Promise<void> {
      check(); let frame: Buffer;
      try { frame = encodeFileWrite(record, bytes, attemptId); } catch { throw new MediaFileWorkerError("INVALID_MEDIA_FILE_WRITE"); }
      await execute({ frame, mode: "write" }, signal);
    },
    /** Local read-only snapshot, not a SQL reconciliation or cleanup capability. */
    async inspect(record: MediaFileRecord, attemptId: string, signal?: AbortSignal): Promise<MediaFileObservation> {
      check(); let frame: Buffer;
      try { frame = encodeFileInspection(record, attemptId); } catch { throw new MediaFileWorkerError("INVALID_MEDIA_FILE_INSPECTION"); }
      return decodeFileObservation(await execute({ frame, mode: "inspect" }, signal));
    },
    /** Trusted read-only callback only. No cleanup authority; scope ends with work/child failure. */
    async observe<T>(work: (inspect: MediaFileInspector) => Promise<T>, signal?: AbortSignal): Promise<T> {
      check(); if (typeof work !== "function") throw unavailable();
      return execute({ mode: "observe", work }, signal);
    },
  };
}
