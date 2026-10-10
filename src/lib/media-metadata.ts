import { AppSessionAccessError, withAppSessionTransaction } from "./app-session-transaction";
import type { MediaFileRecord, MediaFileObservation } from "./media-files";
import type { createLocalMediaFileWorker } from "./media-file-worker";
import type { PostgresDatabase, PostgresQueries } from "./postgres";

type ImageMetadata = Omit<MediaFileRecord, "id">;
export type MediaReservation = MediaFileRecord & { state: "pending" | "ready" };
export type MediaWriteClaim = { attemptId: string; record: MediaFileRecord };
export type MediaWriteAttempt = { attemptId: string; claimedAt: Date };
export type MediaWriteObservation = { state: MediaReservation["state"]; files: MediaFileObservation };
type ErrorCode = "INVALID_MEDIA_METADATA" | "MEDIA_ACCESS_DENIED" | "MEDIA_NOT_FOUND" | "MEDIA_INTENT_CONFLICT" | "MEDIA_IN_PROGRESS" | "MEDIA_QUOTA_EXCEEDED" | "MEDIA_METADATA_UNAVAILABLE";
export class MediaMetadataError extends Error {
  constructor(readonly code: ErrorCode) { super("Media metadata operation failed"); this.name = "MediaMetadataError"; }
}
const columns = `id,mime_type as "mimeType",width,height,size,sha256,state`;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function identifier(value: string): string {
  if (typeof value !== "string" || !uuid.test(value)) throw new MediaMetadataError("INVALID_MEDIA_METADATA");
  return value;
}
function imageMetadata(input: unknown): ImageMetadata {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new MediaMetadataError("INVALID_MEDIA_METADATA");
  const value = input as Record<string, unknown>, keys = Object.keys(value);
  const { mimeType, width, height, size, sha256 } = value;
  if (keys.length !== 5 || keys.some(key => !["mimeType", "width", "height", "size", "sha256"].includes(key)) || mimeType !== "image/webp" ||
      typeof width !== "number" || !Number.isInteger(width) || width < 1 || width > 2048 || typeof height !== "number" || !Number.isInteger(height) || height < 1 || height > 2048 ||
      typeof size !== "number" || !Number.isInteger(size) || size < 12 || size > 2097152 || typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) throw new MediaMetadataError("INVALID_MEDIA_METADATA");
  return { mimeType, width, height, size, sha256 };
}
const fileRecord = (row: MediaReservation): MediaFileRecord => ({ id: row.id, mimeType: row.mimeType, width: row.width, height: row.height, size: row.size, sha256: row.sha256 });

/** Local SQL/FS boundary only. A reservation is NOT a filesystem writer claim/lease. No HTTP or retries. */
export class MediaMetadataRepository {
  constructor(private readonly db: Pick<PostgresDatabase, "transaction">, private readonly files: { read(record: MediaFileRecord): Promise<Buffer> }) { this.assertLocal(); }
  private assertLocal(): void {
    if (typeof window !== "undefined" || !["development", "test"].includes(process.env.NODE_ENV ?? "")) throw new MediaMetadataError("MEDIA_METADATA_UNAVAILABLE");
  }
  private async owned<T>(token: string, work: (tx: PostgresQueries, ownerId: string) => Promise<T>): Promise<T> {
    this.assertLocal();
    try { return await withAppSessionTransaction(this.db, token, (tx, user) => work(tx, user.id)); }
    catch (error) {
      if (error instanceof MediaMetadataError) throw error;
      if (error instanceof AppSessionAccessError) throw new MediaMetadataError("MEDIA_ACCESS_DENIED");
      if (error && typeof error === "object" && "code" in error && error.code === "BL001") throw new MediaMetadataError("MEDIA_QUOTA_EXCEEDED");
      throw new MediaMetadataError("MEDIA_METADATA_UNAVAILABLE");
    }
  }
  async reserve(token: string, intentId: string, input: unknown): Promise<MediaReservation> {
    this.assertLocal(); const intent = identifier(intentId), image = imageMetadata(input);
    return this.owned(token, async (tx, ownerId) => {
      const { rows: [inserted] } = await tx.query<MediaReservation>(`insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256)
        values($1,$2,$3,$4,$5,$6,$7) on conflict(owner_id,intent_id) do nothing returning ${columns}`,
      [ownerId, intent, image.mimeType, image.width, image.height, image.size, image.sha256]);
      if (inserted) return inserted;
      const { rows: [existing] } = await tx.query<MediaReservation>(`select ${columns} from app.media_objects where owner_id=$1 and intent_id=$2`, [ownerId, intent]);
      if (!existing) throw new MediaMetadataError("MEDIA_METADATA_UNAVAILABLE");
      if (existing.mimeType !== image.mimeType || existing.width !== image.width || existing.height !== image.height || existing.size !== image.size || existing.sha256 !== image.sha256) throw new MediaMetadataError("MEDIA_INTENT_CONFLICT");
      if (existing.state !== "ready") throw new MediaMetadataError("MEDIA_IN_PROGRESS");
      return existing;
    });
  }
  async getByIntent(token: string, intentId: string): Promise<MediaReservation | null> {
    this.assertLocal(); const intent = identifier(intentId);
    return this.owned(token, async (tx, ownerId) => {
      const { rows: [row] } = await tx.query<MediaReservation>(`select ${columns} from app.media_objects where owner_id=$1 and intent_id=$2`, [ownerId, intent]);
      return row ?? null;
    });
  }
  /** One-time committed claim; readback/expiry never authorizes another writer. Not OS fencing. */
  async claimWrite(token: string, fileId: string, input: unknown): Promise<MediaWriteClaim> {
    this.assertLocal(); const id = identifier(fileId), image = imageMetadata(input);
    return this.owned(token, async (tx, ownerId) => {
      const { rows: [row] } = await tx.query<MediaReservation>(`select ${columns} from app.media_objects where id=$1 and owner_id=$2 for update`, [id, ownerId]);
      if (!row) throw new MediaMetadataError("MEDIA_NOT_FOUND");
      if (row.mimeType !== image.mimeType || row.width !== image.width || row.height !== image.height || row.size !== image.size || row.sha256 !== image.sha256) throw new MediaMetadataError("MEDIA_INTENT_CONFLICT");
      if (row.state !== "pending") throw new MediaMetadataError("MEDIA_IN_PROGRESS");
      const { rows: [attempt] } = await tx.query<{ attemptId: string }>(`insert into app.media_write_attempts(media_id) values($1)
        on conflict(media_id) do nothing returning id as "attemptId"`, [id]);
      if (!attempt) throw new MediaMetadataError("MEDIA_IN_PROGRESS");
      return { attemptId: attempt.attemptId, record: fileRecord(row) };
    });
  }
  /** Owner-only observation, not a resumed write capability. */
  async getWriteAttempt(token: string, fileId: string): Promise<MediaWriteAttempt | null> {
    this.assertLocal(); const id = identifier(fileId);
    return this.owned(token, async (tx, ownerId) => {
      const { rows: [row] } = await tx.query<MediaWriteAttempt>(`select a.id as "attemptId",a.claimed_at as "claimedAt"
        from app.media_objects m join app.media_write_attempts a on a.media_id=m.id where m.id=$1 and m.owner_id=$2`, [id, ownerId]);
      return row ?? null;
    });
  }
  /** Current owner-only snapshot under the OS fence. Never authorizes cleanup/replay. */
  async observeWrite(token: string, fileId: string, worker: Pick<Awaited<ReturnType<typeof createLocalMediaFileWorker>>, "observe">, signal?: AbortSignal): Promise<MediaWriteObservation> {
    this.assertLocal(); const id = identifier(fileId);
    try {
      return await worker.observe(inspect => this.owned(token, async (tx, ownerId) => {
        const { rows: [row] } = await tx.query<MediaReservation>(`select ${columns} from app.media_objects where id=$1 and owner_id=$2 for update`, [id, ownerId]);
        if (!row) throw new MediaMetadataError("MEDIA_NOT_FOUND");
        const { rows: [attempt] } = await tx.query<{ attemptId: string }>(`select id as "attemptId" from app.media_write_attempts where media_id=$1`, [id]);
        if (!attempt) throw new MediaMetadataError("MEDIA_NOT_FOUND");
        return { state: row.state, files: await inspect(fileRecord(row), attempt.attemptId) };
      }), signal);
    } catch (error) {
      if (error instanceof MediaMetadataError) throw error;
      if (error && typeof error === "object" && "code" in error && error.code === "MEDIA_FILE_WORKER_BUSY") throw new MediaMetadataError("MEDIA_IN_PROGRESS");
      throw new MediaMetadataError("MEDIA_METADATA_UNAVAILABLE");
    }
  }
  async complete(token: string, fileId: string): Promise<MediaReservation> {
    this.assertLocal(); const id = identifier(fileId);
    return this.owned(token, async (tx, ownerId) => {
      const { rows: [row] } = await tx.query<MediaReservation>(`select ${columns} from app.media_objects where id=$1 and owner_id=$2 for update`, [id, ownerId]);
      if (!row) throw new MediaMetadataError("MEDIA_NOT_FOUND");
      await this.files.read(fileRecord(row));
      if (row.state === "ready") return row;
      const { rows: [ready] } = await tx.query<MediaReservation>(`update app.media_objects set state='ready',ready_at=clock_timestamp()
        where id=$1 and owner_id=$2 and state='pending' returning ${columns}`, [id, ownerId]);
      if (!ready) throw new MediaMetadataError("MEDIA_METADATA_UNAVAILABLE");
      return ready;
    });
  }
  async readOwned(token: string, fileId: string): Promise<{ record: MediaFileRecord; bytes: Buffer } | null> {
    this.assertLocal(); const id = identifier(fileId);
    return this.owned(token, async (tx, ownerId) => {
      const { rows: [row] } = await tx.query<MediaReservation>(`select ${columns} from app.media_objects where id=$1 and owner_id=$2 and state='ready'`, [id, ownerId]);
      if (!row || row.state !== "ready") return null;
      const record = fileRecord(row), bytes = await this.files.read(record);
      return { record, bytes };
    });
  }
}
