// Called only by the fresh owned PG18 candidate fixture; never an installed worker/stand.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {loadMediaModule} from './media-module.mjs';
import {fileWorkerModule} from './media-file-worker-module.mjs';
const rootProject=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const {MediaMetadataRepository}=loadMediaModule('media-metadata'),{LocalMediaWriter}=loadMediaModule('media-write'),{LocalMediaRetirement}=loadMediaModule('media-retirement'),{LocalMediaUpload}=loadMediaModule('media-upload');
const bytes=Buffer.from('524946460400000057454250','hex'),image={mimeType:'image/webp',width:1,height:1,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
export async function testMediaRetirementRuntime(suite,{admin,holder,clock,day}){
 const database=(hooks={})=>({transaction:async work=>{
  const client=await admin.connect();let open=false;
  try{
   await client.query('begin');open=true;await client.query("set local lock_timeout='3s';set local statement_timeout='8s'");await hooks.start?.(client);
   const value=await work(client);await client.query('commit');open=false;await hooks.commit?.();return value;
  }catch(error){if(open)await client.query('rollback');throw error;}finally{client.release();}
 }});
 async function fixture(t,options={}){
  await clock(0);const root=await fs.mkdtemp(path.join(tmpdir(),'blizhniy-retirement-runtime-')),proof=await fs.lstat(root,{bigint:true});
  t.after(async()=>{const current=await fs.lstat(root,{bigint:true});assert.equal(current.ino,proof.ino);assert.equal(current.dev,proof.dev);assert.equal(current.uid,BigInt(process.getuid()));assert.ok(current.isDirectory());await fs.rm(root,{recursive:true});});
  await fs.writeFile(path.join(root,'.writer.lock'),'',{mode:0o600,flag:'wx'});
  const owner=(await admin.query('insert into app.users(email,password_hash,email_verified_at) values($1,$2,clock_timestamp()) returning id',['retention-'+randomUUID()+'@example.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)])).rows[0].id,token=randomBytes(32).toString('hex');
  await admin.query('insert into app.sessions(token_hash,user_id,auth_version) select $1,id,auth_version from app.users where id=$2',[createHash('sha256').update(token).digest('hex'),owner]);
  const db=database(),files=await loadMediaModule('media-files').createLocalMediaFileStore(root),worker=await fileWorkerModule(options).createLocalMediaFileWorker(rootProject,root);
  const repo=new MediaMetadataRepository(db,files,true),intent=randomUUID(),pending=await repo.reserve(token,intent,image);
  return{root,owner,token,db,files,worker,repo,intent,pending};
 }
 const budget=async()=> (await admin.query('select charged_bytes::text,charged_objects from app.media_storage_budget')).rows[0];
 async function waiting(pid){const deadline=Date.now()+3000;for(;;){if((await holder.query("select wait_event_type='Lock' waiting from pg_stat_activity where pid=$1",[pid])).rows[0]?.waiting)return;assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,10));}}
 await suite.test('real retirement deletes a verified ready file, preserves intent tombstone, and admits a new empty-owner upload',async t=>{
  const f=await fixture(t);await new LocalMediaWriter(f.repo,f.worker).write(f.token,f.pending.id,{...image,bytes});
  assert.deepEqual((await f.repo.readOwned(f.token,f.pending.id)).bytes,bytes);const before=await budget();await clock(7*day);
  const cleanup=new LocalMediaRetirement(f.db,f.worker),result=await cleanup.retire(f.pending.id);assert.equal(result.status,'completed');
  await assert.rejects(fs.stat(path.join(f.root,f.pending.id+'.webp')),{code:'ENOENT'});assert.equal(await f.repo.readOwned(f.token,f.pending.id),null);
  await assert.rejects(f.repo.getByIntent(f.token,f.intent),{code:'MEDIA_INTENT_CONFLICT'});await assert.rejects(f.repo.reserve(f.token,f.intent,image),{code:'MEDIA_INTENT_CONFLICT'});
  let decodes=0;await assert.rejects(new LocalMediaUpload(f.repo,{normalize:async()=>{decodes++;return{...image,bytes};}},new LocalMediaWriter(f.repo,f.worker)).upload(f.token,f.intent,bytes,'image/webp'),{code:'MEDIA_INTENT_CONFLICT'});assert.equal(decodes,0);
  const after=await budget();assert.equal(BigInt(before.charged_bytes)-BigInt(after.charged_bytes),BigInt(bytes.length));assert.equal(before.charged_objects-after.charged_objects,1);
  assert.equal((await admin.query('select count(*)::int n from app.media_active_usage where owner_id=$1',[f.owner])).rows[0].n,0);
  const next=await f.repo.reserve(f.token,randomUUID(),image);assert.notEqual(next.id,f.pending.id);
  assert.equal((await admin.query('select count(*)::int n from app.media_objects where owner_id=$1',[f.owner])).rows[0].n,2);
 });
 await suite.test('request stays charged at500; one completion permits exactly one concurrent replacement',async t=>{
  const f=await fixture(t);await admin.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) select $1,gen_random_uuid(),'image/webp',1,1,$2,$3 from generate_series(1,499)",[f.owner,bytes.length,image.sha256]);
  await assert.rejects(f.repo.reserve(f.token,randomUUID(),image),{code:'MEDIA_OWNER_QUOTA_EXCEEDED'});await clock(7*day);
  await admin.query('insert into app.media_retirement_requests(media_id,operation_id) values($1,$2)',[f.pending.id,randomUUID()]);
  await assert.rejects(f.repo.reserve(f.token,randomUUID(),image),{code:'MEDIA_OWNER_QUOTA_EXCEEDED'});
  await new LocalMediaRetirement(f.db,f.worker).retire(f.pending.id);
  const results=await Promise.allSettled([f.repo.reserve(f.token,randomUUID(),image),f.repo.reserve(f.token,randomUUID(),image)]);
  assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(results.find(row=>row.status==='rejected').reason.code,'MEDIA_OWNER_QUOTA_EXCEEDED');
  assert.equal((await admin.query('select charged_objects::int n from app.media_active_usage where owner_id=$1',[f.owner])).rows[0].n,500);
 });
 await suite.test('completed retirement also releases owner bytes at the exact250MiB boundary',async t=>{
  const f=await fixture(t),limit=250*1024*1024;
  await admin.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) select $1,gen_random_uuid(),'image/webp',1,1,2097152,$2 from generate_series(1,124)",[f.owner,image.sha256]);
  await admin.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,gen_random_uuid(),'image/webp',1,1,$2,$3)",[f.owner,2097152-bytes.length,image.sha256]);
  await assert.rejects(f.repo.reserve(f.token,randomUUID(),image),{code:'MEDIA_OWNER_QUOTA_EXCEEDED'});await clock(7*day);
  await new LocalMediaRetirement(f.db,f.worker).retire(f.pending.id);
  const results=await Promise.allSettled([f.repo.reserve(f.token,randomUUID(),image),f.repo.reserve(f.token,randomUUID(),image)]);
  assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(results.find(row=>row.status==='rejected').reason.code,'MEDIA_OWNER_QUOTA_EXCEEDED');
  assert.equal((await admin.query('select charged_bytes::text bytes from app.media_active_usage where owner_id=$1',[f.owner])).rows[0].bytes,String(limit));
 });
 await suite.test('a read authorized before retirement finishes before deletion; a waiting read checks the new marker',async t=>{
  const f=await fixture(t);await new LocalMediaWriter(f.repo,f.worker).write(f.token,f.pending.id,{...image,bytes});await clock(7*day);
  let enter,release,pid;const entered=new Promise(resolve=>{enter=resolve;}),held=new Promise(resolve=>{release=resolve;});
  const reader=new MediaMetadataRepository(f.db,{read:async record=>{enter();await held;return f.files.read(record);}},true);
  const read=reader.readOwned(f.token,f.pending.id);await entered;
  const cleanup=new LocalMediaRetirement(database({start:async client=>{pid=(await client.query('select pg_backend_pid() pid')).rows[0].pid;}}),f.worker).retire(f.pending.id);cleanup.catch(()=>{});
  try{while(!pid)await new Promise(resolve=>setTimeout(resolve,10));await waiting(pid);assert.deepEqual(await fs.readFile(path.join(f.root,f.pending.id+'.webp')),bytes);release();assert.deepEqual((await read).bytes,bytes);await cleanup;}
  finally{release();await read;await cleanup;}
  const pending=await f.repo.reserve(f.token,randomUUID(),image);await new LocalMediaWriter(f.repo,f.worker).write(f.token,pending.id,{...image,bytes});await clock(14*day);
  await holder.query('begin');await holder.query('insert into app.media_retirement_requests(media_id,operation_id) values($1,$2)',[pending.id,randomUUID()]);
  let reads=0,readerPid;
  const blocked=new MediaMetadataRepository(database({start:async client=>{readerPid=(await client.query('select pg_backend_pid() pid')).rows[0].pid;}}),{read:async record=>{reads++;return f.files.read(record);}},true).readOwned(f.token,pending.id);blocked.catch(()=>{});
  try{while(!readerPid)await new Promise(resolve=>setTimeout(resolve,10));await waiting(readerPid);await holder.query('commit');assert.equal(await blocked,null);assert.equal(reads,0);}finally{await holder.query('rollback');await blocked;}
 });
 await suite.test('lost request or completion COMMIT response is reconciled explicitly without duplicate release',async t=>{
  for(const failedPhase of [1,2]){
   const f=await fixture(t);await new LocalMediaWriter(f.repo,f.worker).write(f.token,f.pending.id,{...image,bytes});await clock(7*day);const before=await budget();let commits=0;
   const lost=database({commit:async()=>{if(++commits===failedPhase)throw Error('synthetic lost COMMIT acknowledgement');}});
   await assert.rejects(new LocalMediaRetirement(lost,f.worker).retire(f.pending.id),{code:'MEDIA_RETIREMENT_UNAVAILABLE'});assert.equal(commits,failedPhase);
   const recorded=(await admin.query('select operation_id from app.media_retirement_requests where media_id=$1',[f.pending.id])).rows[0].operation_id;
   assert.equal((await admin.query('select count(*)::int n from app.media_retirement_completions where media_id=$1',[f.pending.id])).rows[0].n,failedPhase===2?1:0);
   if(failedPhase===1)assert.deepEqual(await fs.readFile(path.join(f.root,f.pending.id+'.webp')),bytes);
   const result=await new LocalMediaRetirement(f.db,f.worker).retire(f.pending.id);assert.equal(result.operationId,recorded);const after=await budget();assert.equal(BigInt(before.charged_bytes)-BigInt(after.charged_bytes),BigInt(bytes.length));
   const stable=await budget();await new LocalMediaRetirement(f.db,f.worker).retire(f.pending.id);assert.deepEqual(await budget(),stable);
  }
 });
 await suite.test('child death after durable unlink releases no accounting until a fresh fenced reconciliation',async t=>{
  const f=await fixture(t);await new LocalMediaWriter(f.repo,f.worker).write(f.token,f.pending.id,{...image,bytes});await clock(7*day);const before=await budget();
  const fault=await fileWorkerModule({childProcess:{spawn:(command,args,settings)=>spawn(command,Array.from(args,arg=>arg===path.join(rootProject,'scripts/media-file-worker.mjs')?path.join(rootProject,'tests/media-retirement-worker-fault.mjs'):arg),settings)}}).createLocalMediaFileWorker(rootProject,f.root);
  await assert.rejects(new LocalMediaRetirement(f.db,fault).retire(f.pending.id),{code:'MEDIA_RETIREMENT_UNAVAILABLE'});
  await assert.rejects(fs.stat(path.join(f.root,f.pending.id+'.webp')),{code:'ENOENT'});assert.deepEqual(await budget(),before);assert.equal((await admin.query('select count(*)::int n from app.media_retirement_completions where media_id=$1',[f.pending.id])).rows[0].n,0);
  const restarted=await fileWorkerModule().createLocalMediaFileWorker(rootProject,f.root);await new LocalMediaRetirement(f.db,restarted).retire(f.pending.id);
  assert.equal(BigInt(before.charged_bytes)-BigInt((await budget()).charged_bytes),BigInt(bytes.length));
 });
 await suite.test('incomplete temporary evidence quarantines both files and preserves the full accounting charge',async t=>{
  const f=await fixture(t),claim=await f.repo.claimWrite(f.token,f.pending.id,image);
  const final=path.join(f.root,f.pending.id+'.webp'),temporary=path.join(f.root,'.pending-'+claim.attemptId);
  await fs.writeFile(final,bytes,{mode:0o600});await fs.writeFile(temporary,bytes.subarray(0,8),{mode:0o600});const inode=await fs.lstat(temporary,{bigint:true});
  await clock(7*day);const before=await budget();await assert.rejects(new LocalMediaRetirement(f.db,f.worker).retire(f.pending.id),{code:'MEDIA_RETIREMENT_UNAVAILABLE'});
  assert.deepEqual(await fs.readFile(final),bytes);assert.deepEqual(await fs.readFile(temporary),bytes.subarray(0,8));assert.equal((await fs.lstat(temporary,{bigint:true})).ino,inode.ino);assert.deepEqual(await budget(),before);
  assert.equal((await admin.query('select count(*)::int n from app.media_retirement_requests where media_id=$1',[f.pending.id])).rows[0].n,1);
  assert.equal((await admin.query('select count(*)::int n from app.media_retirement_completions where media_id=$1',[f.pending.id])).rows[0].n,0);
  await assert.rejects(f.repo.reserve(f.token,f.intent,image),{code:'MEDIA_INTENT_CONFLICT'});
 });
}
