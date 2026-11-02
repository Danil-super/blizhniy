import { randomUUID } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { authJson } from "./auth-http";
import { readProductionAuthConfig } from "./production-auth-config";
import { getProductionAccountDatabase } from "./production-auth-runtime";
import type { ProductionAuthConfig } from "./production-auth-config";
import { assertMediaRuntime } from "./media-runtime-policy";
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
async function createRuntime(config: ProductionAuthConfig) {
  const policy = assertMediaRuntime(process);
  if (!policy) throw new Error("Production media unavailable");
  const dependencyStat = (path: string) => {
    try { return lstatSync(path); }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') throw new DependencyNotReadyError();
      throw error;
    }
  };
  const validateSocket = () => {
    assertMediaRuntime(process, policy.root, policy.app);
    for (const path of ["/run", "/run/blizhniy-media"]) {
      const info = path === '/run' ? lstatSync(path) : dependencyStat(path);
      if (!info.isDirectory() || info.uid !== 0 || (info.mode & 0o022) || realpathSync(path) !== path) throw new Error("Media socket unavailable");
    }
    const socket = dependencyStat(policy.socket);
    if (!socket.isSocket() || socket.uid !== process.getuid?.() || socket.gid !== process.getgid?.() || (socket.mode & 0o7777) !== 0o600 || socket.nlink !== 1) throw new Error("Media socket unavailable");
  };
  validateSocket();
  const { db, limiter } = await getProductionAccountDatabase(config);
  await db.query("select id,owner_id,intent_id,mime_type,width,height,size,sha256,state,ready_at from app.media_objects limit 0");
  await db.query("select id,media_id,claimed_at from app.media_write_attempts limit 0");
  const files = await createLocalMediaFileStore(policy.root), writer = await createLocalMediaFileWorker(policy.app, policy.root);
  const repository = new MediaMetadataRepository(db, files);
  const normalizer = createMediaSocketClient(policy.socket, validateSocket);
  const upload = new LocalMediaUpload(repository, normalizer, new LocalMediaWriter(repository, writer));
  return { identity: new IdentityStore(db), limiter, upload, repository, files, normalizer };
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
  return (await runtime(config)).normalizer;
}

/** No import-time files/connections, migrations or grants. Operator opt-in and restart only. */
export async function handleProductionMediaRequest(request: Request, operation: "upload" | "read"): Promise<Response> {
  try {
    const config = readProductionAuthConfig();
    if (!config) return authJson({ error: { code: "NOT_FOUND" } }, 404);
    return await createProductionMediaHandler(config, () => runtime(config))(request, operation);
  } catch {
    const requestId = randomUUID();
    console.warn(JSON.stringify({ event: "media_configuration_failed", requestId, code: "MEDIA_UNAVAILABLE" }));
    return authJson({ error: { code: "MEDIA_UNAVAILABLE" } }, 503, { "X-Request-ID": requestId });
  }
}
