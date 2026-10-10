import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { MediaImageError, type NormalizedImage } from "./media-image";
import { decodeMediaReply, MEDIA_INPUT_TYPES, MEDIA_MAX_INPUT_BYTES, MEDIA_MAX_OUTPUT_BYTES, MEDIA_REPLY_HEADER_BYTES } from "./media-worker-protocol";

type WorkerState = { busy: boolean; disabled: boolean };
const runtime = globalThis as typeof globalThis & { __blizhniyLocalMediaWorker?: WorkerState };
const state = runtime.__blizhniyLocalMediaWorker ??= { busy: false, disabled: false };

/** Local Linux/Node 22 supervisor only. rootDirectory is trusted operator configuration, not an upload field. */
export function createLocalMediaWorker(rootDirectory: string) {
  const checkRuntime = () => {
    if (typeof window !== "undefined" || process.platform !== "linux" || !["development", "test"].includes(process.env.NODE_ENV ?? "") || Number(process.versions.node.split(".")[0]) !== 22 || typeof rootDirectory !== "string" || !isAbsolute(rootDirectory)) {
      throw new MediaImageError("MEDIA_UNAVAILABLE");
    }
  };
  checkRuntime();
  const uid = process.getuid!();
  const env = { NODE_ENV: "test" as const, XDG_RUNTIME_DIR: `/run/user/${uid}`, DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${uid}/bus`, LANG: "C" };
  return {
    async normalize(input: Uint8Array, mimeType: string, signal?: AbortSignal): Promise<NormalizedImage> {
      checkRuntime();
      if (!(input instanceof Uint8Array) || !input.byteLength) throw new MediaImageError("INVALID_IMAGE");
      if (input.byteLength > MEDIA_MAX_INPUT_BYTES) throw new MediaImageError("IMAGE_TOO_LARGE");
      const index = MEDIA_INPUT_TYPES.findIndex(type => type === mimeType);
      if (index < 0) throw new MediaImageError("UNSUPPORTED_IMAGE");
      if (signal?.aborted || state.disabled) throw new MediaImageError("MEDIA_UNAVAILABLE");
      if (state.busy) throw new MediaImageError("MEDIA_BUSY");
      state.busy = true;
      try {
        const unit = `blizhniy-media-${randomUUID()}.service`;
        const request = Buffer.concat([Buffer.from([index]), Buffer.from(input)]);
        const child = spawn("/usr/bin/systemd-run", ["--user", "--quiet", "--pipe", "--wait", "--collect", "--service-type=exec", "--expand-environment=no", `--unit=${unit}`,
          ...["MemoryMax=512M", "MemorySwapMax=0", "CPUQuota=100%", "TasksMax=32", "RuntimeMaxSec=8s", "TimeoutStopSec=1s", "KillMode=control-group", "KillSignal=SIGKILL", "NoNewPrivileges=yes", "LimitCORE=0"].map(value => `--property=${value}`),
          "/usr/bin/env", "-i", "NODE_ENV=test", "UV_THREADPOOL_SIZE=2", "VIPS_CONCURRENCY=1", process.execPath, "--experimental-strip-types", "--no-warnings", "--max-old-space-size=128", join(rootDirectory, "scripts/media-worker.mjs"), unit,
        ], { env, shell: false, stdio: ["pipe", "pipe", "ignore"] });
        return await new Promise<NormalizedImage>((resolve, reject) => {
          const chunks: Buffer[] = []; let size = 0, settled = false, stopping = false;
          const finish = (error?: MediaImageError, image?: NormalizedImage) => {
            if (settled) return;
            settled = true; clearTimeout(timer); signal?.removeEventListener("abort", cancel);
            child.stdin.destroy(); child.stdout.destroy();
            if (error) reject(error); else if (image) resolve(image); else reject(new MediaImageError("MEDIA_UNAVAILABLE"));
          };
          const cancel = () => {
            if (settled || stopping) return;
            stopping = true; chunks.length = 0;
            // Killing systemd-run alone would leave its detached service alive.
            const terminated = (error?: unknown) => {
              if (error) state.disabled = true; // No more jobs when termination cannot be confirmed.
              child.kill("SIGKILL"); finish(new MediaImageError("MEDIA_UNAVAILABLE"));
            };
            try {
              execFile("/usr/bin/systemctl", ["--user", "stop", unit], { env, timeout: 1000, killSignal: "SIGKILL", maxBuffer: 4096 }, terminated);
            } catch (error) { terminated(error); }
          };
          const timer = setTimeout(cancel, 10_000);
          signal?.addEventListener("abort", cancel, { once: true });
          child.on("error", () => { if (child.pid) cancel(); else finish(new MediaImageError("MEDIA_UNAVAILABLE")); });
          child.stdin.on("error", () => { /* Worker may reject a request before its pipe is drained. Wait for close/deadline. */ });
          child.stdout.on("error", cancel);
          child.stdout.on("data", (chunk: Buffer) => {
            if (settled || stopping) return;
            size += chunk.length;
            if (size > MEDIA_REPLY_HEADER_BYTES + MEDIA_MAX_OUTPUT_BYTES || chunks.length >= 256) { cancel(); return; }
            chunks.push(chunk);
          });
          child.on("close", code => {
            if (settled || stopping) return;
            if (code !== 0) { finish(new MediaImageError("MEDIA_UNAVAILABLE")); return; }
            try {
              const reply = decodeMediaReply(Buffer.concat(chunks, size));
              if ("error" in reply) finish(new MediaImageError(reply.error)); else finish(undefined, reply);
            } catch { finish(new MediaImageError("MEDIA_UNAVAILABLE")); }
          });
          child.stdin.end(request);
        });
      } catch (error) {
        if (error instanceof MediaImageError) throw error;
        throw new MediaImageError("MEDIA_UNAVAILABLE");
      } finally { state.busy = false; }
    },
  };
}
