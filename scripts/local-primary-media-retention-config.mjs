import {openSync,closeSync,fstatSync,lstatSync,readSync,realpathSync,constants} from 'node:fs';
import {isAbsolute,dirname} from 'node:path';
/** Dedicated cleanup credentials, bound to the owned stand; never accepts URLs or module paths. */
export function readLocalMediaRetentionConfig(file,state,refunds){
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
  if(!value||Object.keys(value).sort().join()!=='containerId,password,project,version'||value.version!==1||value.project!==state.project||value.containerId!==state.containerId||
   ![value.password,refunds?.workerPassword,refunds?.operatorPassword].every(password=>typeof password==='string'&&/^[a-f0-9]{64}$/.test(password))||
   [state.ownerPassword,state.runtimePassword,state.rateSecret,refunds.workerPassword,refunds.operatorPassword].includes(value.password))throw Error();
  return value;
 }catch{throw Error('Local media cleanup configuration unavailable');}
 finally{if(descriptor!==undefined)closeSync(descriptor);}
}
