import Busboy from '@fastify/busboy';
import { Readable } from 'node:stream';

// Legacy endpoints retain their existing authentication and payload validators.
// This boundary only limits ingestion before JSON/text/multipart parsing.
type Mode = 'json' | 'profile' | 'upload';
const policies = {
  json: { maximumBytes: 512 * 1024, deadlineMs: 2000, concurrent: 8 },
  // Existing profile contract is 500000 UTF16 code units, at most3UTF8 bytes each.
  profile: { maximumBytes: 1500000, deadlineMs: 15000, concurrent: 2 },
  // Existing upload contract: ten10MiB files plus multipart metadata.
  upload: { maximumBytes: 101 * 1024 * 1024, deadlineMs: 300000, concurrent: 1 },
} as const;
const runtime = globalThis as typeof globalThis & { __blizhniyLegacyBodies?: Record<Mode, number> };
const state = runtime.__blizhniyLegacyBodies ??= { json: 0, profile: 0, upload: 0 };
export class LegacyBodyError extends Error {
  readonly status: number;
  constructor(status: number) { super('Invalid request body'); this.name = 'LegacyBodyError'; this.status = status; }
}
async function consume<T>(request: Request, mode: Mode, parse: (response: Response) => Promise<T>, deadlineMs: number = policies[mode].deadlineMs): Promise<T> {
  const policy = policies[mode];
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > policy.deadlineMs) throw new Error('Invalid body deadline');
  const reject = (status: number): never => {
    if (request.body && !request.body.locked) void request.body.cancel().catch(() => undefined);
    throw new LegacyBodyError(status);
  };
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > policy.maximumBytes)) return reject(413);
  if (!request.body) return reject(400);
  if (state[mode] >= policy.concurrent) return reject(429);
  const reader = request.body.getReader();
  state[mode]++;
  const deadline = performance.now() + deadlineMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let complete = false, size = 0, emptyChunks = 0;
  let pending: Uint8Array | undefined;
  let offset = 0;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    async pull(output) {
      try {
        if (performance.now() >= deadline) throw new LegacyBodyError(408);
        if (!pending) {
          const part = await reader.read();
          if (performance.now() >= deadline) throw new LegacyBodyError(408);
          if (part.done) { complete = true; output.close(); return; }
          size += part.value.byteLength;
          if (size > policy.maximumBytes || (part.value.byteLength === 0 && ++emptyChunks > 1024)) throw new LegacyBodyError(413);
          pending = part.value;
          offset = 0;
        }
        // Bound synchronous multipart parser work even if the transport delivers
        // the entire request in one chunk. Limits can stop the next slice.
        const end = Math.min(pending.byteLength, offset + 64 * 1024);
        output.enqueue(pending.subarray(offset, end));
        offset = end;
        if (offset === pending.byteLength) pending = undefined;
      } catch (error) { output.error(error); }
    },
    cancel() { void reader.cancel().catch(() => undefined); },
  });
  try {
    const headers = new Headers();
    const type = request.headers.get('content-type');
    if (type) headers.set('content-type', type);
    const result = await Promise.race([
      parse(new Response(stream, { headers })),
      new Promise<never>((_resolve, rejectTimeout) => { timer = setTimeout(() => { const error = new LegacyBodyError(408); controller.error(error); rejectTimeout(error); }, deadlineMs); }),
    ]);
    // Synchronous parser work can delay the timer callback beyond the deadline.
    if (performance.now() >= deadline) throw new LegacyBodyError(408);
    return result;
  } catch (error) {
    if (error instanceof LegacyBodyError) throw error;
    throw new LegacyBodyError(400);
  } finally {
    if (timer) clearTimeout(timer);
    if (!complete) { controller!.error(new LegacyBodyError(400)); void reader.cancel().catch(() => undefined); }
    state[mode]--;
    pending = undefined;
    reader.releaseLock();
  }
}
export function readLegacyJson(request: Request, deadlineMs?: number): Promise<unknown> { return consume(request, 'json', response => response.json(), deadlineMs); }
export function readLegacyProfileText(request: Request, deadlineMs?: number): Promise<string> { return consume(request, 'profile', response => response.text(), deadlineMs); }
const maximumFileBytes = 10 * 1024 * 1024;

function parseMultipart(response: Response): Promise<FormData> {
  const type = response.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data\s*;/i.test(type)) throw new LegacyBodyError(415);
  if (type.length > 1024 || !response.body) throw new LegacyBodyError(400);
  // Native formData() has no field/part count limits. A small body with many tiny
  // fields can allocate far more memory than its byte size suggests.
  const parser = new Busboy({
    headers: { 'content-type': type },
    highWaterMark: 64 * 1024,
    fileHwm: 64 * 1024,
    limits: { files: 10, fileSize: maximumFileBytes + 1, fields: 16, fieldSize: 64 * 1024, parts: 32, headerPairs: 16, headerSize: 8192 },
  });
  const source = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>);
  return new Promise((resolve, reject) => {
    const entries: Array<{ name: string; value: string | File }> = [];
    const files = new Set<Readable>();
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      source.unpipe(parser);
      source.destroy();
      parser.destroy();
      for (const file of files) file.destroy();
      entries.length = 0;
      reject(error instanceof LegacyBodyError ? error : new LegacyBodyError(400));
    };
    const tooLarge = () => fail(new LegacyBodyError(413));
    parser.on('filesLimit', tooLarge).on('fieldsLimit', tooLarge).on('partsLimit', tooLarge);
    parser.on('error', fail);
    source.on('error', fail);
    parser.on('field', (name, value, nameTruncated, valueTruncated) => {
      if (settled) return;
      if (nameTruncated || valueTruncated || !name || Buffer.byteLength(name) > 100) { tooLarge(); return; }
      entries.push({ name, value });
    });
    parser.on('file', (name, file, filename, _encoding, mimeType) => {
      file.on('error', fail);
      if (settled) { file.resume(); return; }
      files.add(file);
      if (!name || Buffer.byteLength(name) > 100) { tooLarge(); return; }
      // Reserve the position now so async file completion preserves form order.
      const entry = { name, value: '' as string | File };
      entries.push(entry);
      const chunks: Buffer[] = [];
      let bytes = 0;
      file.on('limit', tooLarge);
      file.on('data', (chunk: Buffer) => {
        if (settled) return;
        bytes += chunk.length;
        if (bytes > maximumFileBytes) { tooLarge(); return; }
        chunks.push(chunk);
      });
      file.on('close', () => { chunks.length = 0; files.delete(file); });
      file.on('end', () => {
        if (!settled) entry.value = new File([Buffer.concat(chunks, bytes)], filename ?? 'blob', { type: mimeType });
        chunks.length = 0;
        files.delete(file);
      });
    });
    parser.on('finish', () => {
      if (settled) return;
      const form = new FormData();
      for (const entry of entries) form.append(entry.name, entry.value);
      settled = true;
      entries.length = 0;
      resolve(form);
    });
    source.pipe(parser);
  });
}
export function readLegacyFormData(request: Request, deadlineMs?: number): Promise<FormData> { return consume(request, 'upload', parseMultipart, deadlineMs); }
