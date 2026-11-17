import {constants,openSync,closeSync,fstatSync,lstatSync,readSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute} from 'node:path';
/** Only the owned local user-operator credential; never a URL, role choice or module path. */
export function readLocalUserAccessCredentials(file,state){
 let descriptor;
 try{
  if(typeof process.getuid!=='function'||!isAbsolute(file)||state?.origin!=='https://127.0.0.1:3045'||state.database!=='blizhniy_prod')throw Error();
  const parent=lstatSync(dirname(file));
  if(!parent.isDirectory()||parent.uid!==process.getuid()||(parent.mode&0o777)!==0o700||realpathSync(dirname(file))!==dirname(file))throw Error();
  descriptor=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const info=fstatSync(descriptor);
  if(!info.isFile()||info.uid!==process.getuid()||(info.mode&0o777)!==0o600||info.nlink!==1||info.size<1||info.size>2048)throw Error();
  const bytes=Buffer.alloc(2049);let length=0;
  for(;;){const count=readSync(descriptor,bytes,length,bytes.length-length,null);if(!count)break;length+=count;if(length>2048)throw Error();}
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length)));
  if(!value||Object.keys(value).sort().join()!=='containerId,password,project,version'||value.version!==1||value.project!==state.project||value.containerId!==state.containerId||
   typeof value.password!=='string'||!/^[a-f0-9]{64}$/.test(value.password)||new Set([value.password,state.ownerPassword,state.runtimePassword,state.rateSecret]).size!==4)throw Error();
  return value;
 }catch{throw Error('Local user operator credentials unavailable');}
 finally{if(descriptor!==undefined)closeSync(descriptor);}
}
