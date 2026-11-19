import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

// Take metadata and contents from the same regular file, including after a worker has run.
export async function readFixtureFile(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat({ bigint: true });
    assert.ok(stat.isFile(), 'fixture must be a regular file');
    return { stat, bytes: await file.readFile() };
  } finally {
    await file.close();
  }
}
