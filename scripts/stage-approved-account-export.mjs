import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { link, mkdtemp, open, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run=promisify(execFile);
const maximumBytes=16*1024*1024;
const directory='/run/blizhniy-account-export';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hex=/^[a-f0-9]{64}$/;
const processOptions={timeout:10000,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}};

export async function stageApprovedAccountArchive(target,{ownerId,emailSha256,archiveSha256},archive){
 assert.match(ownerId,uuid);
 assert.match(emailSha256,hex);
 assert.match(archiveSha256,hex);
 assert.ok(Buffer.isBuffer(archive)&&archive.length>=3&&archive.length<=maximumBytes);
 assert.ok(archive[0]===0x1f&&archive[1]===0x8b&&archive[2]===8);
 assert.equal(digest(archive),archiveSha256);
 const root=await open(target.directory,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_DIRECTORY);
 let staging;
 try{
  const info=await root.stat();
  assert.ok(info.uid===target.authorityUid&&info.gid===target.groupId&&(info.mode&0o7777)===0o750);
  const anchor='/proc/self/fd/'+root.fd;
  staging=await mkdtemp(join(anchor,'preparing-'));
  const path=join(staging,'archive.tar.gz');
  await writeFile(path,archive,{flag:'wx',mode:0o600});
  const source=join('/proc',String(process.pid),'fd',String(root.fd),basename(staging),'archive.tar.gz');
  const {stdout}=await run('/usr/bin/tar',['-xOzf',source,'--','account.json'],{...processOptions,maxBuffer:maximumBytes});
  const {account}=JSON.parse(stdout);
  assert.equal(account.id,ownerId);
  assert.equal(digest(account.email),emailSha256);
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   await file.chown(target.authorityUid,target.groupId);
   await file.chmod(0o440);
   const now=new Date();
   await file.utimes(now,now);
   await file.sync();
  }finally{await file.close();}
  // Link fails if there is already an issuance, including one waiting for expiry cleanup.
  await link(path,join(anchor,ownerId+'_'+emailSha256+'.tar.gz'));
  await unlink(path);
  await root.sync();
 }finally{
  try{if(staging)await rm(staging,{recursive:true});}finally{await root.close();}
 }
}

async function main(){
 assert.equal(process.getuid(),0);
 assert.equal(process.argv.length,5);
 const [ownerId,emailSha256,archiveSha256]=process.argv.slice(2);
 const {stdout}=await run('/usr/bin/id',['-g','blizhniy-web'],processOptions);
 const groupId=Number(stdout.trim());
 assert.ok(Number.isSafeInteger(groupId)&&groupId>0);
 await run('/usr/bin/systemctl',['is-active','--quiet','blizhniy-account-export-expiry.timer'],processOptions);
 let length=0;
 const chunks=[];
 for await(const chunk of process.stdin){
  length+=chunk.length;
  assert.ok(length<=maximumBytes);
  chunks.push(chunk);
 }
 await stageApprovedAccountArchive({directory,authorityUid:0,groupId},{ownerId,emailSha256,archiveSha256},Buffer.concat(chunks,length));
 console.log('Approved account archive staged for fifteen minutes.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{await main();}catch{
  console.error('Approved account archive was not staged.');
  process.exitCode=1;
 }
}
