import { fstatSync } from 'node:fs';
import { lstat, readFile, readlink, realpath } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readActivatedOperatorSocket(env, socketPath) {
  const fd = 3, directory = dirname(socketPath);
  if (env.LISTEN_PID !== String(process.pid) || env.LISTEN_FDS !== '1' || env.LISTEN_FDNAMES !== 'operator' ||
      !fstatSync(fd).isSocket()) throw Error('Hosted operator socket unavailable');
  const [root,parent,socket,descriptor,unix] = await Promise.all([
    lstat('/run'),lstat(directory),lstat(socketPath),readlink('/proc/self/fd/3'),readFile('/proc/net/unix','utf8'),
  ]);
  const inode = /^socket:\[(\d+)\]$/.exec(descriptor)?.[1];
  if (!inode || !root.isDirectory() || root.uid !== 0 || (root.mode & 0o022) !== 0 ||
      !parent.isDirectory() || parent.uid !== 0 || (parent.mode & 0o7777) !== 0o755 ||
      await realpath(directory) !== directory || !socket.isSocket() || socket.uid !== 0 ||
      (socket.mode & 0o7777) !== 0o660 || socket.nlink !== 1) throw Error('Hosted operator socket unavailable');
  const listeners = unix.trim().split('\n').slice(1).map(line => line.trim().split(/\s+/));
  if (listeners.filter(row => row[3] === '00010000' && row[4] === '0001' && row[6] === inode && row[7] === socketPath).length !== 1) {
    throw Error('Hosted operator socket unavailable');
  }
  return { fd,socketPath };
}
