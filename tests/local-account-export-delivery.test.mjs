import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,rm,writeFile,utimes,readFile,symlink,lstat,link} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createLocalAccountExportHandler,publishLocalAccountArchive,purgeExpiredLocalAccountArchives} from '../scripts/local-account-export-delivery.mjs';
const run=promisify(execFile);

test('a reviewed archive is downloadable only with its owner session before expiry',async t=>{
 const root=await mkdtemp(join(tmpdir(),'blizhniy-export-test-'));
 t.after(()=>rm(root,{recursive:true}));
 const input=join(root,'input'),delivery=join(root,'delivery');
 await mkdir(input,{mode:0o700});await mkdir(delivery,{mode:0o700});await mkdir(join(input,'media'),{mode:0o700});
 const owner=randomUUID(),peer=randomUUID(),mediaId=randomUUID();
 await writeFile(join(input,'account.json'),JSON.stringify({account:{id:owner}}),{mode:0o600});
 const image=Buffer.from('524946460400000057454250','hex');
 await writeFile(join(input,'media',mediaId+'.webp'),image,{mode:0o600});
 const notice={purpose:'Синтетическая проверка',basis:'Тестовый стенд',sources:'Данные тестового владельца',
  recipients:'Владелец',retention:'Только на время репетиции'};
 await assert.rejects(publishLocalAccountArchive(input,delivery,peer,notice),{name:'DeletionAccessError'});
 const {id}=await publishLocalAccountArchive(input,delivery,owner,notice);
 const origin='https://example.invalid',a='a'.repeat(64),b='b'.repeat(64);
 const handler=createLocalAccountExportHandler({origin,delivery,session:async token=>({id:token===a?owner:peer}),allow:async()=>true});
 const request=(token,body={access:'data-subject',id},overrides={})=>new Request(origin+'/api/account/export',{method:'POST',
  headers:{host:'example.invalid',origin,'x-real-ip':'127.0.0.1','x-blizhniy-request':'1','content-type':'application/json',
   ...(token?{cookie:'__Host-blizhniy_data_subject='+token}:{}),...overrides},body:JSON.stringify(body)});
 assert.equal((await handler(request(null))).status,401);
 assert.equal((await handler(request(b))).status,404);
 assert.equal((await handler(request(a,{access:'data-subject',id:'../outside'}))).status,422);
 assert.equal((await handler(request(a,undefined,{origin:'https://other.invalid'}))).status,403);
 const received=await handler(request(a));
 assert.equal(received.status,200);
 assert.match(received.headers.get('cache-control'),/no-store/);
 assert.equal(received.headers.get('content-disposition'),'attachment; filename="blizhniy-account.tar.gz"');
 const archive=Buffer.from(await received.arrayBuffer());
 assert.equal(archive.subarray(0,2).toString('hex'),'1f8b');
 const file=join(delivery,owner+'_'+id+'.tar.gz');
 assert.deepEqual(archive,await readFile(file));
 const extract=async entry=>(await run('/usr/bin/tar',['-xOzf',file,'--',entry],{encoding:'buffer'})).stdout;
 assert.deepEqual(JSON.parse(await extract('account.json')),{account:{id:owner}});
 assert.deepEqual(JSON.parse(await extract('processing.json')),notice);
 assert.deepEqual(await extract('media/'+mediaId+'.webp'),image);
 const indirect=randomUUID();
 await symlink(file,join(delivery,owner+'_'+indirect+'.tar.gz'));
 assert.equal((await handler(request(a,{access:'data-subject',id:indirect}))).status,503);
 const stale=new Date(Date.now()-16*60*1000);
 await utimes(file,stale,stale);
 assert.equal((await handler(request(a))).status,404);
});

test('expired synthetic archives are removed without touching current files, links or other names',async t=>{
 const previous=process.env.NODE_ENV;process.env.NODE_ENV='test';
 t.after(()=>{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;});
 const root=await mkdtemp(join(tmpdir(),'blizhniy-export-purge-test-'));
 t.after(()=>rm(root,{recursive:true}));
 const delivery=join(root,'delivery');
 await mkdir(delivery,{mode:0o700});
 const archive=()=>join(delivery,randomUUID()+'_'+randomUUID()+'.tar.gz');
 const expired=archive(),fresh=archive(),hard=archive(),symbolic=archive();
 const other=join(delivery,'other.tar.gz'),outside=join(root,'outside.tar.gz');
 const bytes=Buffer.from([0x1f,0x8b,0x08]);
 const past=new Date(Date.now()-16*60*1000);
 for(const path of [expired,fresh,other,outside])await writeFile(path,bytes,{mode:0o600});
 for(const path of [expired,other,outside])await utimes(path,past,past);
 await link(outside,hard);await symlink(outside,symbolic);
 assert.equal(await purgeExpiredLocalAccountArchives(delivery),1);
 await assert.rejects(lstat(expired),{code:'ENOENT'});
 for(const path of [fresh,other,outside,hard,symbolic])assert.deepEqual(await readFile(path),bytes);
 assert.equal(await purgeExpiredLocalAccountArchives(delivery),0);
 assert.equal(await purgeExpiredLocalAccountArchives(join(root,'absent')),0);
});
