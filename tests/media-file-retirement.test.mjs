import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {loadMediaModule} from './media-module.mjs';
const bytes=Buffer.from('524946460400000057454250','hex');
async function fixture(t,overrides={}){
 const root=await fs.mkdtemp(path.join(tmpdir(),'blizhniy-media-retire-')),identity=await fs.lstat(root,{bigint:true});
 t.after(async()=>{const current=await fs.lstat(root,{bigint:true});assert.equal(current.ino,identity.ino);assert.equal(current.dev,identity.dev);assert.equal(current.uid,BigInt(process.getuid()));assert.ok(current.isDirectory());await fs.rm(root,{recursive:true});});
 const record={id:randomUUID(),mimeType:'image/webp',width:1,height:1,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},attemptId=randomUUID();
 const store=await loadMediaModule('media-files',{}, {...fs,...overrides}).createLocalMediaFileRetirer(root);
 return{root,record,attemptId,store,final:path.join(root,record.id+'.webp'),temporary:path.join(root,'.pending-'+attemptId)};
}
test('verified complete final/temporary pair retires together; absence replay preserves unrelated files',async t=>{
 const f=await fixture(t);await fs.writeFile(f.temporary,bytes,{mode:0o600});await fs.link(f.temporary,f.final);
 const other=path.join(f.root,'unrelated');await fs.writeFile(other,bytes,{mode:0o600});
 await f.store.retire(f.record,f.attemptId);await f.store.retire(f.record,f.attemptId);
 assert.deepEqual(await fs.readdir(f.root),['unrelated']);assert.deepEqual(await fs.readFile(other),bytes);
});
test('one unsafe or incomplete leaf prevents deletion of both known leaves',async t=>{
 for(const content of [Buffer.alloc(0),bytes.subarray(0,8),Buffer.alloc(bytes.length),Buffer.concat([bytes,Buffer.from([0])])]){
  const f=await fixture(t);await fs.writeFile(f.final,bytes,{mode:0o600});await fs.writeFile(f.temporary,content,{mode:0o600});
  await assert.rejects(f.store.retire(f.record,f.attemptId),{code:'MEDIA_FILE_UNAVAILABLE'});
  assert.deepEqual(await fs.readFile(f.final),bytes);assert.deepEqual(await fs.readFile(f.temporary),content);
 }
});
test('symlinks, directories, extra hardlinks and public permissions cannot authorize retirement',async t=>{
 for(const setup of [async f=>fs.symlink('unrelated',f.final),async f=>fs.mkdir(f.final),async f=>fs.link(path.join(f.root,'unrelated'),f.final),async f=>fs.writeFile(f.final,bytes,{mode:0o644})]){
  const f=await fixture(t);await fs.writeFile(path.join(f.root,'unrelated'),bytes,{mode:0o600});await setup(f);
  const before=await fs.lstat(f.final,{bigint:true});await assert.rejects(f.store.retire(f.record,f.attemptId),{code:'MEDIA_FILE_UNAVAILABLE'});
  assert.equal((await fs.lstat(f.final,{bigint:true})).ino,before.ino);assert.deepEqual(await fs.readFile(path.join(f.root,'unrelated')),bytes);
 }
});
test('directory sync failure is unknown even after unlink; a fresh absence pass must sync again',async t=>{
 let syncs=0,fail=true;
 const f=await fixture(t,{open:async(...args)=>{const handle=await fs.open(...args);if((args[1]&constants.O_DIRECTORY)!==0)handle.sync=async()=>{syncs++;if(fail)throw new Error('synthetic sync failure');};return handle;}});
 await fs.writeFile(f.final,bytes,{mode:0o600});await assert.rejects(f.store.retire(f.record,f.attemptId),{code:'MEDIA_FILE_UNAVAILABLE'});assert.equal(syncs,1);
 fail=false;const fresh=await loadMediaModule('media-files',{}, {...fs,open:async(...args)=>{const handle=await fs.open(...args);if((args[1]&constants.O_DIRECTORY)!==0)handle.sync=async()=>{syncs++;};return handle;}}).createLocalMediaFileRetirer(f.root);
 await fresh.retire(f.record,f.attemptId);assert.equal(syncs,2);assert.deepEqual(await fs.readdir(f.root),[]);
});
test('no write attempt permits only already absent final file, never an unexplained file',async t=>{
 const f=await fixture(t);await f.store.retire(f.record,null);await fs.writeFile(f.final,bytes,{mode:0o600});
 await assert.rejects(f.store.retire(f.record,null),{code:'MEDIA_FILE_UNAVAILABLE'});assert.deepEqual(await fs.readFile(f.final),bytes);
});
