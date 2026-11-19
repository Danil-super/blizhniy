import { randomUUID } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { authJson } from "./auth-http";
import { readProductionAuthConfig } from "./production-auth-config";
import { getProductionAccountDatabase } from "./production-auth-runtime";
import type { ProductionAuthConfig } from "./production-auth-config";
import { assertMediaRuntime, getLegacyDecoderSocket } from "./media-runtime-policy";
import { createMediaSocketClient } from "./media-socket";
import { createLocalMediaFileStore } from "./media-files";
import { createLocalMediaFileWorker } from "./media-file-worker";
import { MediaMetadataRepository } from "./media-metadata";
import { LocalMediaWriter } from "./media-write";
import { LocalMediaUpload } from "./media-upload";
import { IdentityStore } from "./identity";
import { createProductionMediaHandler } from "./production-media-http";
import { ReadOnlyInitialization, DependencyNotReadyError } from './read-only-initialization.ts';

const shared = globalThis as typeof globalThis & { blizhniyProductionMedia?: ReadOnlyInitialization<Awaited<ReturnType<typeof createRuntime>>> };
function decoderSocketCheck(socketPath: string, validateRuntime: () => void) {
  const dependencyStat = (path: string) => {
    try { return lstatSync(path); }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') throw new DependencyNotReadyError();
      throw error;
    }
  };
  return () => {
    validateRuntime();
    for (const path of ["/run", "/run/blizhniy-media"]) {
      const info = path === '/run' ? lstatSync(path) : dependencyStat(path);
      if (!info.isDirectory() || info.uid !== 0 || (info.mode & 0o022) || realpathSync(path) !== path) throw new Error("Media socket unavailable");
    }
    const socket = dependencyStat(socketPath);
    if (!socket.isSocket() || socket.uid !== process.getuid?.() || socket.gid !== process.getgid?.() || (socket.mode & 0o7777) !== 0o600 || socket.nlink !== 1) throw new Error("Media socket unavailable");
  };
}

function createRestrictedDecoder(socketPath: string, validateSocket: () => void) {
  validateSocket();
  return createMediaSocketClient(socketPath, validateSocket);
}

let legacyDecoder: ReturnType<typeof createRestrictedDecoder> | undefined;

export function getLegacyProductionDecoder() {
  if (!legacyDecoder) {
    const path = getLegacyDecoderSocket(process);
    legacyDecoder = createRestrictedDecoder(path, decoderSocketCheck(path, () => { getLegacyDecoderSocket(process); }));
  }
  return legacyDecoder;
}

async function createRuntime(config: ProductionAuthConfig) {
  const policy = assertMediaRuntime(process);
  if (!policy) throw new Error("Production media unavailable");
  const checkSocket = decoderSocketCheck(policy.socket, () => { assertMediaRuntime(process, policy.root, policy.app); });
  // Serving an existing file tolerates an absent decoder, but a misconfigured socket still fails closed.
  try { checkSocket(); } catch (error) { if (!(error instanceof DependencyNotReadyError)) throw error; }
  const { db, limiter } = await getProductionAccountDatabase(config);
  await db.query("select id,owner_id,intent_id,mime_type,width,height,size,sha256,state,ready_at from app.media_objects limit 0");
  await db.query("select id,media_id,claimed_at from app.media_write_attempts limit 0");
  const files = await createLocalMediaFileStore(policy.root);
  const repository = new MediaMetadataRepository(db, files);
  const writing = new ReadOnlyInitialization(async () => {
    const normalizer = createRestrictedDecoder(policy.socket, checkSocket);
    const writer = await createLocalMediaFileWorker(policy.app, policy.root);
    return { normalizer, upload: new LocalMediaUpload(repository, normalizer, new LocalMediaWriter(repository, writer)) };
  });
  return { identity: new IdentityStore(db), limiter, repository, files, writing };
}
function runtime(config: ProductionAuthConfig) {
  shared.blizhniyProductionMedia ??= new ReadOnlyInitialization(() => createRuntime(config));
  return shared.blizhniyProductionMedia.get();
}

/** Trusted server composition only. The calling repository must authorize the exact resource first. */
export async function getProductionMediaFileReader(config: ProductionAuthConfig) {
  const state = await runtime(config);
  return { read: state.files.read };
}

/** Trusted profile composition. Reuses the same restricted decoder and capacity as uploads. */
export async function getProductionMediaNormalizer(config: ProductionAuthConfig) {
  const state = await runtime(config);
  return (await state.writing.get()).normalizer;
}

/** No import-time files/connections, migrations or grants. Operator opt-in and restart only. */
export async function handleProductionMediaRequest(request: Request, operation: "upload" | "read"): Promise<Response> {
  try {
    const config = readProductionAuthConfig();
    if (!config) return authJson({ error: { code: "NOT_FOUND" } }, 404);
    return await createProductionMediaHandler(config, async () => {
      const state = await runtime(config);
      return operation === "read" ? state : { ...state, ...await state.writing.get() };
    })(request, operation);
  } catch {
    const requestId = randomUUID();
    console.warn(JSON.stringify({ event: "media_configuration_failed", requestId, code: "MEDIA_UNAVAILABLE" }));
    return authJson({ error: { code: "MEDIA_UNAVAILABLE" } }, 503, { "X-Request-ID": requestId });
  }
}
