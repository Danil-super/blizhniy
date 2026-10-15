import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const membership = /^0::\/(?:[a-zA-Z0-9_.@:-]+\/)*blizhniy-media-check\.service\n?$/;
const unavailable = () => new Error('Photo sandbox unavailable');
export function assertPhotoSandbox({ uid, gid, node, env, status, cgroup, limits }) {
  if (!Number.isInteger(uid) || uid <= 0 || !Number.isInteger(gid) || gid <= 0 || !/^22\.(?:1[89]|[2-9]\d)\.\d+$/.test(node) ||
      env.NODE_ENV !== 'production' || Object.keys(env).some(key => /^(?:PG|DATABASE|POSTGRES|SMTP|SUPABASE|NODE_OPTIONS)|SECRET|TOKEN|CREDENTIAL/i.test(key)) ||
      !/^NoNewPrivs:\s+1$/m.test(status) || !/^CapEff:\s+0+$/m.test(status) || !/^CapAmb:\s+0+$/m.test(status) || !membership.test(cgroup) ||
      limits.memory.trim() !== '536870912' || limits.swap.trim() !== '0' || limits.tasks.trim() !== '32' || limits.cpu.trim() !== '100000 100000') throw unavailable();
}
async function check() {
  if (process.argv.length !== 3 || process.argv[2] !== '--check' || process.platform !== 'linux') throw unavailable();
  const cgroup = await readFile('/proc/self/cgroup', 'utf8');
  if (!membership.test(cgroup)) throw unavailable();
  const root = '/sys/fs/cgroup' + cgroup.trim().slice(3);
  const [memory, swap, tasks, cpu, status] = await Promise.all(['memory.max', 'memory.swap.max', 'pids.max', 'cpu.max']
    .map(name => readFile(root + '/' + name, 'utf8')).concat(readFile('/proc/self/status', 'utf8')));
  assertPhotoSandbox({ uid: process.getuid(), gid: process.getgid(), node: process.versions.node, env: process.env, status, cgroup, limits: { memory, swap, tasks, cpu } });
  // Only generated pixels; no uploaded input, file paths, credentials or external calls.
  const { default: sharp } = await import('sharp');
  const { normalizeMediaImage } = await import('../src/lib/media-image.ts');
  const input = await sharp({ create: { width: 80, height: 40, channels: 3, background: 'red' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const image = await normalizeMediaImage(input, 'image/jpeg');
  const metadata = await sharp(image.bytes).metadata();
  if (image.width !== 40 || image.height !== 80 || image.size > 2097152 || metadata.format !== 'webp' || metadata.exif || metadata.icc || metadata.xmp || metadata.iptc) throw unavailable();
  process.stdout.write(JSON.stringify({ event: 'media_sandbox_check', status: 'ok', node: process.version, uid: process.getuid(), width: image.width, height: image.height }) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await check(); }
  catch { process.stdout.write(JSON.stringify({ event: 'media_sandbox_check', status: 'unavailable' }) + '\n'); process.exitCode = 1; }
}
