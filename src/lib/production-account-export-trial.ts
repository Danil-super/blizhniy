import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { readAccountSessionToken } from './account-cookie';
import { AuthRequestError, authJson, readAuthJson } from './auth-http';
import { getTrustedProxyIp } from './trusted-proxy-ip';

const lifetime = 15 * 60_000;
const trialMaximumBytes = 1024 * 1024;
const approvedMaximumBytes = 16 * 1024 * 1024;
export const accountExportTrialDirectory = '/run/blizhniy-account-export-test';
export const approvedAccountExportDirectory = '/run/blizhniy-account-export';
export function approvedAccountExportEnabled() {
  return process.env.BLIZHNIY_ACCOUNT_EXPORT === 'operator-approved';
}
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
type Principal = { id: string; email: string };
type ArchiveAccess = {
  origin: string;
  directory: string;
  authorityUid: number;
  resolve: (token: string) => Promise<Principal | null>;
  allow: (ip: string) => Promise<boolean>;
};

async function readArchive({ directory, authorityUid }: ArchiveAccess, { id, email }: Principal, download: boolean, maximumBytes: number) {
  // The operator stages reviewed archives. The web process can only read the directory.
  const root = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
  try {
    const info = await root.stat();
    if (info.uid !== authorityUid || (info.mode & 0o7777) !== 0o750) throw new Error('Unsafe account export directory');
    const emailHash = createHash('sha256').update(email).digest('hex');
    const file = await open(join('/proc/self/fd', String(root.fd), id + '_' + emailHash + '.tar.gz'),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      const age = Date.now() - stat.mtimeMs;
      if (!stat.isFile() || stat.uid !== authorityUid || stat.nlink !== 1 || (stat.mode & 0o7777) !== 0o440 ||
          stat.size < 3 || stat.size > maximumBytes || age < 0 || age >= lifetime) return null;
      const bytes = new Uint8Array(download ? stat.size : 3);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      if (bytesRead !== bytes.length || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8) return null;
      return bytes;
    } finally {
      await file.close();
    }
  } finally {
    await root.close();
  }
}

export function createAccountExportTrial(trial: ArchiveAccess & { ownerId: string }) {
  if (!uuid.test(trial.ownerId)) return async () => authJson({ error: { code: 'NOT_FOUND' } }, 404);
  return createArchiveDownload(trial, trialMaximumBytes, trial.ownerId);
}

export function createApprovedAccountExport(access: ArchiveAccess) {
  return createArchiveDownload(access, approvedMaximumBytes);
}

function createArchiveDownload(access: ArchiveAccess, maximumBytes: number, trialOwnerId?: string) {
  return async (request: Request): Promise<Response> => {
    try {
      const input = await readAuthJson(request, access);
      if (!input || typeof input !== 'object' || Object.keys(input).length !== 1 || !('action' in input) ||
          (input.action !== 'available' && input.action !== 'download')) throw new AuthRequestError(422, 'INVALID_INPUT');
      const ip = getTrustedProxyIp(request.headers);
      if (!ip) throw new AuthRequestError(403, 'UNTRUSTED_INGRESS');
      const token = readAccountSessionToken(request);
      if (!token) throw new AuthRequestError(401, 'UNAUTHENTICATED');
      if (!await access.allow(ip)) throw new AuthRequestError(429, 'RATE_LIMITED');
      const principal = await access.resolve(token);
      if (!principal) throw new AuthRequestError(401, 'UNAUTHENTICATED');
      if (!uuid.test(principal.id) || (trialOwnerId !== undefined && principal.id !== trialOwnerId)) throw new AuthRequestError(404, 'NOT_FOUND');

      const bytes = await readArchive(access, principal, input.action === 'download', maximumBytes).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT' || error.code === 'ELOOP') return null;
        throw error;
      });
      if (input.action === 'available') return authJson({ available: bytes !== null }, 200);
      if (!bytes) throw new AuthRequestError(404, 'NOT_FOUND');
      return new Response(bytes, { headers: {
        'Content-Type': 'application/gzip', 'Content-Disposition': 'attachment; filename="blizhniy-account.tar.gz"',
        'Content-Length': String(bytes.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      } });
    } catch (error) {
      if (error instanceof AuthRequestError) return authJson({ error: { code: error.code } }, error.status);
      return authJson({ error: { code: 'EXPORT_UNAVAILABLE' } }, 503);
    }
  };
}
