import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdtemp, open, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';
import sharp from 'sharp';
import {hashSessionToken} from '../src/lib/identity.ts';
import {loadMediaModule} from './media-module.mjs';

const run = promisify(execFile);
const {createLocalMediaFileStore} = loadMediaModule('media-files');
const {MediaMetadataRepository} = loadMediaModule('media-metadata');

// Called while the disposable source DB and private directory have no other writers.
export async function backupPrivatePhoto(db, owner, directory) {
  const source = await mkdtemp(join(directory, 'source-media-'));
  const bytes = await sharp({create:{width:16,height:9,channels:3,background:'#59a488'}}).webp().toBuffer();
  const photo = {mimeType:'image/webp',width:16,height:9,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  const {rows:[{id}]} = await db.query(`insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256)
    values($1,$2,$3,$4,$5,$6,$7) returning id`, [owner,randomUUID(),photo.mimeType,photo.width,photo.height,photo.size,photo.sha256]);
  const sourceFiles = await createLocalMediaFileStore(source);
  await sourceFiles.write({...photo,id}, bytes);
  await db.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=$1",[id]);
  const file = id+'.webp', archive = join(directory,'private-media.tar');
  const packed = await run('/usr/bin/tar',['-c','-f','-','-C',source,'--',file],{encoding:'buffer'});
  await writeFile(archive,packed.stdout,{mode:0o600,flag:'wx'});
  return {id, owner, file, archive, bytes, photo};
}

export async function verifyRestoredPrivatePhoto(db, transactions, directory, backup) {
  const target = await mkdtemp(join(directory,'restored-media-'));
  const repo = new MediaMetadataRepository(transactions, await createLocalMediaFileStore(target));
  const {rows:[peer]} = await db.query(`insert into app.users(email,password_hash,email_verified_at)
    select 'other-media-restore@example.invalid',password_hash,clock_timestamp() from app.users where id=$1 returning id`,[backup.owner]);
  async function session(userId) {
    const token = randomBytes(32).toString('hex');
    await db.query("insert into app.sessions(token_hash,user_id,auth_version,scope) select $1,id,auth_version,'app' from app.users where id=$2",
      [hashSessionToken(token),userId]);
    return token;
  }
  const ownerToken = await session(backup.owner), otherToken = await session(peer.id);
  const read = () => repo.readOwned(ownerToken,backup.id);
  await assert.rejects(read(),{code:'MEDIA_METADATA_UNAVAILABLE'});
  const extract = () => run('/usr/bin/tar',['-x','-f',backup.archive,'-C',target,'--',backup.file]);
  await extract();
  const path = join(target,backup.file);
  const file = await open(path, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    assert.ok(stat.isFile());
    assert.equal(stat.mode & 0o777,0o600);
    const restored = await read();
    assert.deepEqual(restored.bytes,backup.bytes);
    assert.equal(restored.record.sha256,backup.photo.sha256);
    assert.equal(await repo.readOwned(otherToken,backup.id),null);
    const damaged = Buffer.from(backup.bytes);
    damaged[damaged.length-1] ^= 1;
    await file.writeFile(damaged);
  } finally {
    await file.close();
  }
  await assert.rejects(read(),{code:'MEDIA_METADATA_UNAVAILABLE'});
  await extract();
  assert.deepEqual((await read()).bytes,backup.bytes);
}
