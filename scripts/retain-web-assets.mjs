import {lstatSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readRollbackBuildId} from './check-rollback-readiness.mjs';
import {verifyHandoffAssets} from './handoff-assets.mjs';

// The operator creates this directory when enabling the Caddy static route.
export function retainWebAssets(directory, runningRelease, nextRelease) {
  const info = lstatSync(directory, {throwIfNoEntry: false});
  if (!info?.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o7022) ||
      realpathSync(directory) !== directory) throw new Error('Untrusted static directory');

  const releases = [runningRelease || nextRelease, nextRelease];
  for (const release of new Set(releases)) {
    if (!release.startsWith(dirname(directory) + '/')) throw new Error('Untrusted release parent');
    readRollbackBuildId(release);
  }
  const roots = releases.map(release => join(release, '.next', 'static'));
  verifyHandoffAssets(roots);

  const slots = ['running', 'incoming'];
  for (const name of slots) {
    const slot = lstatSync(join(directory, name), {throwIfNoEntry: false});
    if (slot && !slot.isSymbolicLink()) throw new Error('Unexpected static slot');
  }
  const temporary = mkdtempSync(join(directory, '.prepare-'));
  try {
    // Publish the running build first. It stays reachable if the second rename fails.
    for (const [index, name] of slots.entries()) {
      const link = join(temporary, name);
      symlinkSync(roots[index], link);
      renameSync(link, join(directory, name));
    }
  } finally {
    rmSync(temporary, {recursive: true, force: true});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 5) throw new Error('Expected a static directory and two release paths');
  retainWebAssets(...process.argv.slice(2));
}
