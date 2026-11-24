import { lstatSync } from 'node:fs';
import { createConnection } from 'node:net';

const socketPath = '/run/blizhniy-account-export-prepare.sock';

export async function prepareApprovedAccountExport(caseId: string, operatorToken: string) {
  const root = lstatSync('/run');
  const info = lstatSync(socketPath);
  if (!root.isDirectory() || root.uid !== 0 || (root.mode & 0o022) !== 0 ||
      !info.isSocket() || info.uid !== 0 || info.gid !== process.getgid?.() || (info.mode & 0o7777) !== 0o660) {
    throw new Error('Approved export service unavailable');
  }
  const frame = Buffer.from(JSON.stringify({ caseId, operatorToken }));
  try {
    await new Promise<void>((resolve, reject) => {
      const client = createConnection({ path: socketPath, allowHalfOpen: true });
      const replies: Buffer[] = [];
      let bytes = 0;
      let prepared = false;
      const deadline = setTimeout(() => client.destroy(), 40_000);
      client.once('connect', () => client.end(frame));
      client.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 64) client.destroy();
        else replies.push(chunk);
      });
      client.once('end', () => { prepared = Buffer.concat(replies).toString('utf8') === 'prepared\n'; });
      client.once('error', () => client.destroy());
      client.once('close', (hadError) => {
        clearTimeout(deadline);
        if (prepared && !hadError) resolve();
        else reject(new Error('Approved export service unavailable'));
      });
    });
  } finally {
    frame.fill(0);
  }
}
