import {openSync,closeSync,fstatSync,lstatSync,readSync,realpathSync,constants} from 'node:fs';
import {isAbsolute,dirname} from 'node:path';

/** Fixed local role credentials only; no URLs, merchant keys or module paths. */
export function readLocalPrimaryRefundConfig(file,state){
 let descriptor;
 try{
  if(!isAbsolute(file)||state?.origin!=='https://127.0.0.1:3045'||state.database!=='blizhniy_prod')throw Error();
  const parent=lstatSync(dirname(file));
  if(!parent.isDirectory()||parent.uid!==process.getuid()||(parent.mode&0o777)!==0o700||realpathSync(dirname(file))!==dirname(file))throw Error();
  descriptor=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const info=fstatSync(descriptor);
  if(!info.isFile()||info.uid!==process.getuid()||(info.mode&0o777)!==0o600||info.nlink!==1||info.size>2048)throw Error();
  const bytes=Buffer.alloc(2049);let length=0;
  for(;;){const count=readSync(descriptor,bytes,length,bytes.length-length,null);if(!count)break;length+=count;if(length>2048)throw Error();}
  const value=JSON.parse(bytes.subarray(0,length).toString('utf8'));
  if(!value||Object.keys(value).sort().join()!=='containerId,operatorPassword,project,version,workerPassword'||value.version!==1||
   value.project!==state.project||value.containerId!==state.containerId||![value.operatorPassword,value.workerPassword].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))||
   new Set([value.operatorPassword,value.workerPassword,state.ownerPassword,state.runtimePassword]).size!==4)throw Error();
  return value;
 }catch{throw Error('Local refund configuration unavailable');}
 finally{if(descriptor!==undefined)closeSync(descriptor);}
}
