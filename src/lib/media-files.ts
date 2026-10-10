import { randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { open, realpath, link, lstat, unlink, type FileHandle } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { encodeMediaReply, MEDIA_MAX_OUTPUT_BYTES } from "./media-worker-protocol.ts";

export type MediaFileRecord = { id: string; mimeType: "image/webp"; width: number; height: number; size: number; sha256: string };
export type MediaFileStatus = "absent" | "complete" | "incomplete" | "unsafe";
export type MediaFileObservation = { final: MediaFileStatus; temporary: MediaFileStatus; linked: boolean };
type FileErrorCode = "INVALID_MEDIA_FILE" | "MEDIA_FILE_EXISTS" | "MEDIA_FILE_UNAVAILABLE";
export class MediaFileError extends Error {
  readonly code: FileErrorCode;
  constructor(code: FileErrorCode) { super("Media file operation failed"); this.name = "MediaFileError"; this.code = code; }
}
const unavailable = () => new MediaFileError("MEDIA_FILE_UNAVAILABLE");
const sameInode = (a: Pick<BigIntStats, "dev" | "ino">, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino;

function snapshotRecord(input: MediaFileRecord): MediaFileRecord {
  try {
    const { id, mimeType, width, height, size, sha256 } = input;
    if (typeof id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id) || mimeType !== "image/webp" ||
        !Number.isInteger(width) || width < 1 || width > 2048 || !Number.isInteger(height) || height < 1 || height > 2048 ||
        !Number.isInteger(size) || size < 12 || size > MEDIA_MAX_OUTPUT_BYTES || typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error();
    return { id, mimeType, width, height, size, sha256 };
  } catch { throw new MediaFileError("INVALID_MEDIA_FILE"); }
}

/** Local primitive, NOT authorization. Only a future guarded SQL reservation may supply records.
 * rootDirectory is pre-provisioned operator configuration outside releases/public; never an upload path.
 * The hierarchy and this UID must be trusted: this is not a sandbox against same-UID writers/root. */
export async function createLocalMediaFileStore(rootDirectory: string, expectedRoot?: Pick<BigIntStats, "dev" | "ino">) {
  let identity: BigIntStats | undefined, disabled = false;
  const checkRuntime = () => {
    if (typeof window !== "undefined" || process.platform !== "linux" || !["development", "test"].includes(process.env.NODE_ENV ?? "") ||
        typeof rootDirectory !== "string" || !isAbsolute(rootDirectory) || resolve(rootDirectory) !== rootDirectory || rootDirectory === "/" || disabled) throw unavailable();
  };
  const privateFile = (info: BigIntStats) => info.isFile() && info.uid === BigInt(process.getuid!()) && (info.mode & BigInt(0o7777)) === BigInt(0o600);
  const withRoot = async <T>(work: (directory: FileHandle, anchored: string) => Promise<T>): Promise<T> => {
    checkRuntime(); let directory: FileHandle | undefined;
    try {
      directory = await open(rootDirectory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      const info = await directory.stat({ bigint: true }), anchored = `/proc/self/fd/${directory.fd}`;
      if (!info.isDirectory() || info.uid !== BigInt(process.getuid!()) || (info.mode & BigInt(0o7777)) !== BigInt(0o700) ||
          (identity && !sameInode(identity, info)) || (expectedRoot && !sameInode(expectedRoot, info)) || await realpath(anchored) !== rootDirectory) throw unavailable();
      identity ??= info;
      // Flat leaves below the pinned descriptor; no caller-controlled intermediate directories.
      return await work(directory, anchored);
    } catch (error) { if (error instanceof MediaFileError) throw error; throw unavailable(); }
    finally { await directory?.close().catch(() => { disabled = true; throw unavailable(); }); }
  };
  await withRoot(async () => undefined);
  return {
    /** Snapshot of two known names, NOT ownership, durability or permission to delete/release. */
    async inspect(input: MediaFileRecord, attemptId: string): Promise<MediaFileObservation> {
      checkRuntime(); const record = snapshotRecord(input);
      if (typeof attemptId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(attemptId)) throw new MediaFileError("INVALID_MEDIA_FILE");
      return withRoot(async (_directory, anchored) => {
        const paths = [`${anchored}/${record.id}.webp`, `${anchored}/.pending-${attemptId}`];
        const stat = async (path: string) => {
          try { return await lstat(path, { bigint: true }); }
          catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null; throw error; }
        };
        const before = await Promise.all(paths.map(stat));
        const stable = (a: BigIntStats | null, b: BigIntStats | null) => a === null ? b === null : b !== null && sameInode(a, b) &&
          a.size === b.size && a.mode === b.mode && a.uid === b.uid && a.nlink === b.nlink && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
        // Two links are explainable only when BOTH known names reference this private inode.
        const paired = before[0] !== null && before[1] !== null && privateFile(before[0]) && privateFile(before[1]) &&
          sameInode(before[0], before[1]) && before[0].nlink === BigInt(2) && before[1].nlink === BigInt(2);
        const inspect = async (path: string, initial: BigIntStats | null): Promise<MediaFileStatus> => {
          if (!initial) return "absent";
          if (!privateFile(initial) || initial.nlink !== BigInt(paired ? 2 : 1) || initial.size > BigInt(record.size)) return "unsafe";
          let file: FileHandle | undefined;
          try {
            file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            if (!stable(initial, await file.stat({ bigint: true }))) throw unavailable();
            // Incomplete does not assert valid content or provenance. Nothing is deleted.
            if (initial.size < BigInt(record.size)) return "incomplete";
            const bytes = Buffer.alloc(record.size + 1); let length = 0;
            while (length < bytes.length) {
              const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
              if (!bytesRead) break; length += bytesRead;
            }
            if (length !== record.size || !stable(initial, await file.stat({ bigint: true }))) throw unavailable();
            try { encodeMediaReply({ ...record, bytes: bytes.subarray(0, length) }); }
            catch { return "unsafe"; }
            return "complete";
          } finally { await file?.close().catch(() => { disabled = true; throw unavailable(); }); }
        };
        const final = await inspect(paths[0], before[0]), temporary = await inspect(paths[1], before[1]);
        const after = await Promise.all(paths.map(stat));
        if (before.some((info, index) => !stable(info, after[index]))) throw unavailable();
        return { final, temporary, linked: paired && final !== "unsafe" && temporary !== "unsafe" };
      });
    },
    async write(input: MediaFileRecord, source: Uint8Array, attemptId?: string): Promise<void> {
      checkRuntime(); const record = snapshotRecord(input);
      if (attemptId !== undefined && (typeof attemptId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(attemptId))) throw new MediaFileError("INVALID_MEDIA_FILE");
      let bytes: Buffer;
      try {
        if (!(source instanceof Uint8Array) || source.byteLength !== record.size) throw new Error();
        bytes = Buffer.from(source); encodeMediaReply({ ...record, bytes });
      } catch { throw new MediaFileError("INVALID_MEDIA_FILE"); }
      return withRoot(async (directory, anchored) => {
        const temporary = `${anchored}/.pending-${attemptId ?? randomUUID()}`, destination = `${anchored}/${record.id}.webp`;
        let file: FileHandle | undefined, owned: BigIntStats | undefined, published = false, temporaryExists = false;
        const removeOwnedTemporary = async () => {
          if (!temporaryExists) return;
          if (!owned) throw unavailable();
          // Ownership evidence is the exclusively-created inode, not a filename or self-written marker.
          const current = await lstat(temporary, { bigint: true });
          if (!sameInode(owned, current) || !privateFile(current) || current.nlink < BigInt(1) || current.nlink > BigInt(2)) throw unavailable();
          await unlink(temporary); temporaryExists = false;
        };
        try {
          file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          temporaryExists = true;
          owned = await file.stat({ bigint: true });
          if (!privateFile(owned) || owned.nlink !== BigInt(1)) throw unavailable();
          await file.writeFile(bytes); await file.sync();
          const complete = await file.stat({ bigint: true });
          if (!sameInode(owned, complete) || !privateFile(complete) || complete.size !== BigInt(record.size) || complete.nlink !== BigInt(1)) throw unavailable();
          try { await link(temporary, destination); }
          catch (error) {
            if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") throw new MediaFileError("MEDIA_FILE_EXISTS");
            throw error;
          }
          published = true;
          await removeOwnedTemporary(); await directory.sync();
        } catch (error) {
          // After publication an I/O failure means UNKNOWN, not rollback: retain the object for SQL readback/reconciliation.
          if (published) disabled = true;
          throw error;
        } finally {
          try { await removeOwnedTemporary(); }
          catch { disabled = true; throw unavailable(); }
          finally { await file?.close().catch(() => { disabled = true; throw unavailable(); }); }
        }
      });
    },
    async read(input: MediaFileRecord): Promise<Buffer> {
      checkRuntime(); const record = snapshotRecord(input);
      return withRoot(async (_directory, anchored) => {
        let file: FileHandle | undefined;
        try {
          file = await open(`${anchored}/${record.id}.webp`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          const before = await file.stat({ bigint: true });
          if (!privateFile(before) || before.nlink !== BigInt(1) || before.size !== BigInt(record.size)) throw unavailable();
          // One extra byte detects growth; never readFile an attacker-controlled, potentially growing file.
          const bytes = Buffer.alloc(record.size + 1); let length = 0;
          while (length < bytes.length) {
            const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
            if (!bytesRead) break;
            length += bytesRead;
          }
          const after = await file.stat({ bigint: true });
          if (length !== record.size || !sameInode(before, after) || !privateFile(after) || after.nlink !== BigInt(1) || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) throw unavailable();
          const result = bytes.subarray(0, length); encodeMediaReply({ ...record, bytes: result });
          return result;
        } finally { await file?.close().catch(() => { disabled = true; throw unavailable(); }); }
      });
    },
  };
}
