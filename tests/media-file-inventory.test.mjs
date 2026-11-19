import { readFixtureFile } from './read-fixture-file.mjs';
import assert from 'node:assert/strict';import {test} from 'node:test';
import fs from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import{randomUUID,createHash}from'node:crypto';import sharp from 'sharp';
import {readMediaFileInventory} from '../scripts/media-file-inventory.mjs';
process.env.NODE_ENV='test';
const bytes=await sharp({create:{width:8,height:4,channels:3,background:'#618477'}}).webp().toBuffer();
async function fixture(t){
 const root=await fs.mkdtemp(join(tmpdir(),'blizhniy-file-inventory-')),proof=await fs.lstat(root,{bigint:true});
 t.after(async()=>{const now=await fs.lstat(root,{bigint:true});assert.equal(now.ino,proof.ino);assert.equal(now.dev,proof.dev);assert.equal(now.uid,BigInt(process.getuid()));await fs.chmod(root,0o700);await fs.rm(root,{recursive:true});});
 await fs.writeFile(join(root,'.writer.lock'),'',{mode:0o600});
 const record={id:randomUUID(),mimeType:'image/webp',width:8,height:4,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};return{root,record,attemptId:randomUUID()};
}
test('inventory recognizes complete and incomplete known leaves and never changes their contents',async t=>{
 const f=await fixture(t),final=join(f.root,f.record.id+'.webp'),temp=join(f.root,'.pending-'+f.attemptId);
 await fs.writeFile(final,bytes,{mode:0o600});await fs.writeFile(temp,bytes.subarray(0,12),{mode:0o600});
 const { stat: before } = await readFixtureFile(temp);
 const report=await readMediaFileInventory(f.root,[{record:f.record,attemptId:f.attemptId}]);
 assert.equal(report.cleanupAuthorized,false);assert.equal(report.objects[0].final,'complete');assert.equal(report.objects[0].temporary,'incomplete');assert.equal(report.summary.manualReview,1);assert.equal(report.summary.unknownEntries,0);
 const after = await readFixtureFile(temp);
 assert.deepEqual(await fs.readFile(final),bytes);
 assert.deepEqual(after.bytes, bytes.subarray(0,12));
 assert.equal(after.stat.ino, before.ino);
 assert.equal(after.stat.dev, before.dev);
});
test('unknown names and symlinks are retained, not opened or exposed in a report',async t=>{
 const f=await fixture(t),name='private-owner@example.invalid',outside=join(f.root,name);await fs.writeFile(outside,'private-content',{mode:0o600});await fs.symlink(outside,join(f.root,'unknown-link'));
 const report=await readMediaFileInventory(f.root,[]);assert.equal(report.summary.unknownEntries,2);assert.equal(report.summary.manualReview,2);assert.ok(report.unknown.every(row=>/^[a-f0-9]{64}$/.test(row.nameSha256)&&row.action==='retain'));assert.equal(JSON.stringify(report).includes(name),false);assert.equal(JSON.stringify(report).includes('private-content'),false);
 assert.deepEqual((await fs.readdir(f.root)).sort(),['.writer.lock',name,'unknown-link'].sort());assert.equal(await fs.readFile(outside,'utf8'),'private-content');
});
test('metadata without an attempt is visibly unverified and an unrelated temporary file stays unknown',async t=>{
 const f=await fixture(t);await fs.writeFile(join(f.root,f.record.id+'.webp'),bytes,{mode:0o600});await fs.writeFile(join(f.root,'.pending-'+f.attemptId),Buffer.alloc(0),{mode:0o600});
 const report=await readMediaFileInventory(f.root,[{record:f.record,attemptId:null}]);assert.equal(report.objects[0].final,'unverified');assert.equal(report.objects[0].temporary,'not-reserved');assert.equal(report.summary.unknownEntries,1);assert.equal(report.summary.manualReview,2);
});
test('invalid metadata, duplicate identities, excessive input and a public root fail closed',async t=>{
 const f=await fixture(t),item={record:f.record,attemptId:f.attemptId};
 for(const items of [[item,item],[{record:{...f.record,id:'../escape'},attemptId:f.attemptId}],Array(10001).fill(item)])await assert.rejects(readMediaFileInventory(f.root,items),{message:'MEDIA_FILE_INVENTORY_UNAVAILABLE'});
 await fs.chmod(f.root,0o755);await assert.rejects(readMediaFileInventory(f.root,[]),{message:'MEDIA_FILE_INVENTORY_UNAVAILABLE'});assert.deepEqual(await fs.readdir(f.root),['.writer.lock']);
});
test('only local test runtime may inspect and record identity is captured before any await',async t=>{
 const f=await fixture(t),old=f.record.id;await fs.writeFile(join(f.root,old+'.webp'),bytes,{mode:0o600});const promise=readMediaFileInventory(f.root,[{record:f.record,attemptId:f.attemptId}]);f.record.id=randomUUID();const report=await promise;assert.equal(report.objects[0].id,old);assert.equal(report.objects[0].final,'complete');
 process.env.NODE_ENV='production';try{await assert.rejects(readMediaFileInventory(f.root,[]),{message:'MEDIA_FILE_INVENTORY_UNAVAILABLE'});}finally{process.env.NODE_ENV='test';}
});
