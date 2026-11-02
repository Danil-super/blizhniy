import {constants,openSync,closeSync,fstatSync,lstatSync,realpathSync,writeFileSync,fsyncSync,unlinkSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const terminal=['complete','not-started','not-promoted','rolled-back'];
const states=[...terminal,'recovery-required','complete-old-retained'];
const fail=()=>new Error('Handoff journal unavailable');

/** Exclusive, operator-owned lease. Crash/unknown outcome leaves evidence and lock;
 * there is deliberately no PID-based stale-lock removal or automatic replay. */
function createJournal(directory,operationId){
 if(typeof directory!=='string'||!isAbsolute(directory)||typeof operationId!=='string'||!uuid.test(operationId))throw fail();
 const info=lstatSync(directory);
 if(!info.isDirectory()||info.uid!==process.getuid()||(info.mode&0o7777)!==0o700||realpathSync(directory)!==directory)throw fail();
 const lockPath=join(directory,'.handoff.lock'),journalPath=join(directory,operationId+'.jsonl');
 let lock,fd,closed=false,records=0,lease,lastResult;
 const syncDirectory=()=>{const d=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(d);}finally{closeSync(d);}};
 try{
  lock=openSync(lockPath,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  lease=fstatSync(lock);writeFileSync(lock,JSON.stringify({operationId,pid:process.pid})+'\n');fsyncSync(lock);syncDirectory();
  fd=openSync(journalPath,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_APPEND,0o600);
  fsyncSync(fd);syncDirectory();
 }catch{if(fd!==undefined)closeSync(fd);if(lock!==undefined)closeSync(lock);throw fail();}
 const check=()=>{
  if(closed)throw fail();const parent=lstatSync(directory),saved=lstatSync(lockPath),current=fstatSync(fd),named=lstatSync(journalPath);
  if(!parent.isDirectory()||parent.dev!==info.dev||parent.ino!==info.ino||parent.uid!==process.getuid()||(parent.mode&0o7777)!==0o700||realpathSync(directory)!==directory||named.dev!==current.dev||named.ino!==current.ino||!named.isFile()||named.isSymbolicLink())throw fail();
  if(saved.dev!==lease.dev||saved.ino!==lease.ino||saved.nlink!==1||saved.uid!==process.getuid()||(saved.mode&0o7777)!==0o600||!current.isFile()||current.nlink!==1||current.uid!==process.getuid()||(current.mode&0o7777)!==0o600||current.size>1024*1024)throw fail();
 };
 const close=()=>{if(!closed){closed=true;try{closeSync(fd);}finally{closeSync(lock);}}};
 return {async record(value){
  try{check();
  if(!value||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw fail();
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(descriptors).some(k=>typeof k!=='string'||!Object.hasOwn(descriptors[k],'value')))throw fail();
  const event=Object.fromEntries(Object.entries(descriptors).map(([k,d])=>[k,d.value]));
  const keys=['operationId','action','phase','slot','port','state','previousBuildId','nextBuildId','previousPort','nextPort'];
  if(!event||![Object.prototype,null].includes(Object.getPrototypeOf(event))||Reflect.ownKeys(event).some(k=>typeof k!=='string'||!keys.includes(k))||event.operationId!==operationId||!['check','start','switch','promote','drain','result'].includes(event.action)||!['intent','observed'].includes(event.phase)||++records>64)throw fail();
  if(event.slot!==undefined&&!['blue','green'].includes(event.slot)||event.state!==undefined&&!states.includes(event.state))throw fail();
  for(const key of ['port','previousPort','nextPort'])if(event[key]!==undefined&&(!Number.isSafeInteger(event[key])||event[key]<1024||event[key]>65535))throw fail();
  for(const key of ['previousBuildId','nextBuildId'])if(event[key]!==undefined&&(typeof event[key]!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(event[key])))throw fail();
  // Serialize only the validated plain record; timestamps are local, not supplied.
  writeFileSync(fd,JSON.stringify({...event,at:Date.now()})+'\n');fsyncSync(fd);lastResult=event.action==='result'&&event.phase==='observed'?event.state:undefined;return true;
  }catch{throw fail();}
 },finish(result){
  try{check();if(!result||typeof result!=='object')return false;
  const op=Object.getOwnPropertyDescriptor(result,'operationId'),state=Object.getOwnPropertyDescriptor(result,'state');
  if(!op||!state||op.value!==operationId||!terminal.includes(state.value)||lastResult!==state.value)return false;
  check();unlinkSync(lockPath);syncDirectory();close();return true;
  }catch{throw fail();}
 },close};
}

export function openHandoffJournal(directory,operationId){
 try{return createJournal(directory,operationId);}catch{throw fail();}
}
