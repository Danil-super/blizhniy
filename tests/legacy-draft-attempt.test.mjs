import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareLegacyDraftMedia} from '../src/lib/legacy-draft-attempt.ts';

test('a draft reuses its key and acknowledged uploads for newly wrapped files with the same content', async () => {
  const form = {}, owner = 'owner';
  let uploads = 0;
  const upload = async () => ({paths: [String(++uploads)]});
  const data = bytes => {
    const payload = new FormData();
    payload.append('photos', new File([bytes], 'photo.webp', {type: 'image/webp'}));
    return payload;
  };
  const save = (bytes, element = form, account = owner) => prepareLegacyDraftMedia(element, account, data(bytes), upload);
  const [first, repeated] = await Promise.all([save('abc'), save('abc')]);
  assert.deepEqual(first, repeated);
  assert.equal(uploads, 1);
  const changed = await save('xyz');
  assert.equal(changed.creationKey, first.creationKey);
  assert.deepEqual(changed.paths, ['2']);
  assert.notEqual((await save('abc', {})).creationKey, first.creationKey);
  assert.notEqual((await save('abc', form, 'another owner')).creationKey, first.creationKey);
});

test('a failed upload can be retried on the open form; pending photo preparation never uses old paths', async () => {
  const form = {}, data = new FormData();
  await assert.rejects(prepareLegacyDraftMedia(form, 'owner', data, async () => {throw Error('upload failed');}), /upload failed/);
  const result = await prepareLegacyDraftMedia(form, 'owner', data, async () => ({paths: ['ready']}));
  assert.deepEqual(result.paths, ['ready']);
  data.set('photosPreparing', '1');
  await assert.rejects(prepareLegacyDraftMedia(form, 'owner', data, async () => ({paths: []})), /подготовки/);
});
