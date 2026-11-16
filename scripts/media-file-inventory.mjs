// Read-only evidence, never provenance or permission to move/delete files or release quota.
import {constants} from 'node:fs';
import {open,opendir,lstat,realpath} from 'node:fs/promises';
import {isAbsolute,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createLocalMediaFileStore} from '../src/lib/media-files.ts';
import {encodeFileRetirement,decodeFileRetirement} from '../src/lib/media-file-retirement-protocol.ts';
const unavailable=()=>Error('MEDIA_FILE_INVENTORY_UNAVAILABLE');
const same=(a,b)=>['dev','ino','size','mode','uid','nlink','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);
const privateFile=info=>info.isFile()&&info.uid===BigInt(process.getuid())&&(info.mode&0o7777n)===0o600n;
export async function readMediaFileInventory(root,items){
 let directory;
 try{
  if(typeof window!=='undefined'||process.platform!=='linux'||process.env.NODE_ENV!=='test'||typeof root!=='string'||!isAbsolute(root)||resolve(root)!==root||root==='/'||!Array.isArray(items)||items.length>10000)throw unavailable();
  // Reuse the strict nullable-attempt parser to freeze metadata; no frame is sent.
  const records=items.map(item=>decodeFileRetirement(encodeFileRetirement(item.record,item.attemptId)));
  const expected=new Set(['.writer.lock']),ids=new Set(),attempts=new Set();let contentBytes=0;
  for(const {record,attemptId} of records){
   if(ids.has(record.id)||(attemptId!==null&&attempts.has(attemptId)))throw unavailable();ids.add(record.id);expected.add(record.id+'.webp');
   if(attemptId!==null){attempts.add(attemptId);expected.add('.pending-'+attemptId);contentBytes+=2*record.size;}
  }
  if(contentBytes>64*1024*1024)throw unavailable();
  const deadline=performance.now()+3000,check=()=>{if(performance.now()>=deadline)throw unavailable();};check();
  directory=await open(root,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);const proof=await directory.stat({bigint:true}),anchor='/proc/self/fd/'+directory.fd;
  if(!proof.isDirectory()||proof.uid!==BigInt(process.getuid())||(proof.mode&0o7777n)!==0o700n||await realpath(anchor)!==root)throw unavailable();
  const names=async()=>{const result=[];for await(const entry of await opendir(anchor)){check();result.push(entry.name);if(result.length>20001)throw unavailable();}if(new Set(result).size!==result.length)throw unavailable();return result.sort();};
  const beforeNames=await names(),before=new Map();
  for(const name of beforeNames){check();before.set(name,await lstat(anchor+'/'+name,{bigint:true}));}
  const lock=before.get('.writer.lock');if(!lock||!privateFile(lock)||lock.nlink!==1n||lock.size!==0n)throw unavailable();
  const {inspect}=await createLocalMediaFileStore(root,proof),objects=[];
  for(const {record,attemptId} of records){
   check();let observation;
   if(attemptId!==null)observation=await inspect(record,attemptId);
   else{const final=before.get(record.id+'.webp');observation={final:!final?'absent':!privateFile(final)||final.nlink!==1n?'unsafe':'unverified',temporary:'not-reserved',linked:false};}
   objects.push({id:record.id,...observation,action:'retain'});
  }
  const unknown=[];
  for(const name of beforeNames)if(!expected.has(name)){
   const info=before.get(name);unknown.push({nameSha256:createHash('sha256').update(name).digest('hex'),kind:info.isSymbolicLink()?'symlink':info.isDirectory()?'directory':info.isFile()?'regular':'other',bytes:String(info.size),privateOwner:info.uid===BigInt(process.getuid()),links:String(info.nlink),action:'retain'});
  }
  if(JSON.stringify(await names())!==JSON.stringify(beforeNames))throw unavailable();
  for(const [name,info] of before){check();if(!same(info,await lstat(anchor+'/'+name,{bigint:true})))throw unavailable();}
  const after=await directory.stat({bigint:true});if(after.dev!==proof.dev||after.ino!==proof.ino||after.uid!==proof.uid||after.mode!==proof.mode||await realpath(anchor)!==root)throw unavailable();check();
  return{version:1,cleanupAuthorized:false,filesystem:'observed-read-only',limits:{objects:10000,entries:20001,contentBytes:64*1024*1024,deadlineMs:3000},
   summary:{objects:objects.length,unknownEntries:unknown.length,completeFinal:objects.filter(row=>row.final==='complete').length,absentFinal:objects.filter(row=>row.final==='absent').length,
    manualReview:unknown.length+objects.filter(row=>['incomplete','unsafe','unverified'].includes(row.final)||!['absent','not-reserved'].includes(row.temporary)).length},objects,unknown};
 }catch{throw unavailable();}
 finally{try{await directory?.close();}catch{throw unavailable();}}
}
