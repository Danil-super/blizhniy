import { lstatSync } from 'node:fs';
import { createConnection } from 'node:net';
import { parseAdminPasskeyOptions } from './admin-passkey-contract';

const socketPath = '/run/blizhniy-account-export-prepare.sock';

export async function requestApprovedAccountExport(caseId: string, operatorToken: string, credential?: object) {
  const root = lstatSync('/run');
  const info = lstatSync(socketPath);
  if (!root.isDirectory() || root.uid !== 0 || (root.mode & 0o022) !== 0 ||
      !info.isSocket() || info.uid !== 0 || info.gid !== process.getgid?.() || (info.mode & 0o7777) !== 0o660) {
    throw new Error('Approved export service unavailable');
  }
  const frame = Buffer.from(JSON.stringify({ action: credential ? 'prepare' : 'options', caseId, operatorToken, credential }));
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const client = createConnection({ path: socketPath, allowHalfOpen: true });
      const replies: Buffer[] = [];
      let bytes = 0;
      let done = false;
      const deadline = setTimeout(() => client.destroy(), credential ? 55_000 : 22_000);
      client.once('connect', () => client.end(frame));
      client.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > (credential ? 64 : 32_768)) client.destroy();
        else replies.push(chunk);
      });
      client.once('end', () => { done = true; });
      client.once('error', () => client.destroy());
      client.once('close', (hadError) => {
        clearTimeout(deadline);
        try {
          if (!done || hadError) throw new Error();
          const reply = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(replies, bytes));
          if (!credential) return resolve(parseAdminPasskeyOptions(JSON.parse(reply)));
          if (reply !== 'prepared\n') throw new Error();
          resolve(undefined);
        } catch { reject(new Error('Approved export service unavailable')); }
      });
    });
  } finally {
    frame.fill(0);
  }
}
