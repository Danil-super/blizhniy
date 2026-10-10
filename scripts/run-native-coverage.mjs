// Fixed direct-import suite. VM/transpiled fixtures are intentionally not attributed to source.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tests = ['postgres', 'identity', 'auth-http', 'postgres-tariffs', 'server-request-timeout',
  'media-image', 'media-file-protocol', 'media-worker-protocol', 'local-reference-admin'];
if (process.argv.length !== 2 || Number(process.versions.node.split('.')[0]) !== 22) {
  console.error('Native coverage requires Node22 and no extra arguments');
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--experimental-test-coverage',
    '--test-coverage-include=src/**', '--test-reporter=spec', '--test-reporter=./scripts/native-coverage-reporter.mjs',
    '--test-reporter-destination=stderr', '--test-reporter-destination=stdout', '--test',
    ...tests.map(name => `tests/${name}.test.mjs`)], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
}
