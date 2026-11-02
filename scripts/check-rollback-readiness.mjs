import {constants,openSync,closeSync,fstatSync,lstatSync,realpathSync,readSync} from 'node:fs';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
import {probeWebSlot} from './handoff-probe.mjs';
import {webSlot} from './rolling-web-handoff.mjs';

const unavailable=()=>new Error('Rollback metadata unavailable');

/** Operator input only. Validate the immutable release path before process changes.
 * Root-owned sticky shared ancestors (/tmp) protect owned child entries too. */
export function readRollbackBuildId(release){
 let fd;
 try{
  if(typeof release!=='string'||!isAbsolute(release)||resolve(release)!==release||realpathSync(release)!==release)throw unavailable();
  for(const path of [release,join(release,'.next')]){
   const info=lstatSync(path);
   if(!info.isDirectory()||info.uid!==process.getuid()||(info.mode&0o7022)||realpathSync(path)!==path)throw unavailable();
  }
  for(let path=dirname(release);;path=dirname(path)){
   const info=lstatSync(path),sharedSticky=info.uid===0&&(info.mode&0o1777)===0o1777;
   if(!info.isDirectory()||![0,process.getuid()].includes(info.uid)||((info.mode&0o22)&&!sharedSticky))throw unavailable();
   if(path===dirname(path))break;
  }
  fd=openSync(join(release,'.next','BUILD_ID'),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const info=fstatSync(fd);
  if(!info.isFile()||info.uid!==process.getuid()||info.nlink!==1||(info.mode&0o7022)||info.size<1||info.size>129)throw unavailable();
  const bytes=Buffer.alloc(130);let count=0,n;
  while(count<bytes.length&&(n=readSync(fd,bytes,count,bytes.length-count,count))>0)count+=n;
  if(count!==info.size)throw unavailable();
  const text=bytes.subarray(0,count).toString('utf8'),id=text.endsWith('\n')?text.slice(0,-1):text;
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw unavailable();return id;
 }catch{throw unavailable();}
 finally{if(fd!==undefined){try{closeSync(fd);}catch{throw unavailable();}}}
}

/** Only GET probes repeat during startup; one deadline covers every HTTP stage
 * and every attempt. No process, symlink, database or payment writes occur here. */
export async function verifyRollbackReadiness({port,buildId,deadlineMs=45000}){
 const slot=webSlot({slot:'blue',port,buildId});
 if(!Number.isSafeInteger(deadlineMs)||deadlineMs<100||deadlineMs>45000)throw new Error('Invalid rollback deadline');
 const end=performance.now()+deadlineMs;
 for(;;){
  const remaining=Math.ceil(end-performance.now());if(remaining<100)return {ready:false};
  const proof=await probeWebSlot(slot,{deadlineMs:Math.min(10000,remaining)});
  if(proof.ready===true&&proof.buildId===slot.buildId&&performance.now()<=end)return {ready:true};
  const delay=Math.min(250,Math.max(0,Math.floor(end-performance.now())-100));
  if(delay===0)return {ready:false};await pause(delay);
 }
}

async function main(){
 const args=process.argv.slice(2);
 if(args.length===2&&args[0]==='--build-id'){process.stdout.write(readRollbackBuildId(args[1])+'\n');return;}
 if(args.length!==3||args[0]!=='--probe'||!/^[1-9][0-9]{3,4}$/.test(args[1]))throw new Error('Invalid rollback arguments');
 if(!(await verifyRollbackReadiness({port:Number(args[1]),buildId:args[2]})).ready){process.stderr.write('Rollback readiness verification failed\n');process.exitCode=1;return;}
 process.stdout.write('Rollback health, database, HTML and build checks passed\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(()=>{process.stderr.write('Rollback verification unavailable\n');process.exitCode=2;});
}
