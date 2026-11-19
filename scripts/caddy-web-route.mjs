import {lstatSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute} from 'node:path';
import {boundedHandoffRequest} from './handoff-http.mjs';
const resource='/id/blizhniy-web/upstreams';
const etag=value=>typeof value==='string'&&/^"[A-Za-z0-9_ /.:\-]{1,300}"$/.test(value);
const failure=code=>Object.assign(new Error('Caddy handoff unavailable'),{code});

/** Fixed scope over a private admin socket. The deploy lease covers all writers. */
export function createCaddyWebRoute({socketPath,ports,deadlineMs=5000,peerUid=process.getuid()}){
 if(typeof socketPath!=='string'||!isAbsolute(socketPath)||socketPath.length>100||!Number.isSafeInteger(peerUid)||peerUid<0||peerUid>4294967294||/[\x00-\x1f\x7f]/.test(socketPath)||!Number.isInteger(deadlineMs)||deadlineMs<1||deadlineMs>30000||!Array.isArray(ports)||ports.length!==2||new Set(ports).size!==2||ports.some(p=>!Number.isSafeInteger(p)||p<1024||p>65535))throw failure('HANDOFF_CONFIGURATION');
 const allowed=[...ports];
 const validate=()=>{
  try{const directory=dirname(socketPath),parent=lstatSync(directory),socket=lstatSync(socketPath);
  if(realpathSync(directory)!==directory||!parent.isDirectory()||parent.uid!==peerUid||(parent.mode&0o7777)!==0o700||!socket.isSocket()||socket.uid!==peerUid||socket.nlink!==1||(socket.mode&0o7777)!==0o600)throw failure('HANDOFF_CONFIGURATION');
  }catch{throw failure('HANDOFF_CONFIGURATION');}
 };
 const send=async(method,headers={},body)=>{
  validate();return boundedHandoffRequest({socketPath,path:resource,method,headers:{host:'localhost',...headers},body},{deadlineMs,maxBytes:4096});
 };
 const read=async()=>{
  const response=await send('GET');
  if(response.status!==200||!etag(response.etag))throw failure('HANDOFF_READ');
  let value;try{value=JSON.parse(response.body.toString('utf8'));}catch{throw failure('HANDOFF_READ');}
  if(!Array.isArray(value)||value.length!==1||!value[0]||Object.keys(value[0]).join()!=='dial')throw failure('HANDOFF_READ');
  const port=allowed.find(p=>value[0].dial===`127.0.0.1:${p}`);
  if(port===undefined)throw failure('HANDOFF_READ');
  return Object.freeze({port,etag:response.etag});
 };
 return {read,async switch(expected,target){
  if(!expected||!allowed.includes(expected.port)||!etag(expected.etag)||!allowed.includes(target)||target===expected.port)throw failure('HANDOFF_CONFIGURATION');
  const response=await send('PATCH',{'if-match':expected.etag,'content-type':'application/json'},JSON.stringify([{dial:`127.0.0.1:${target}`} ]));
  if(response.status===412)throw failure('HANDOFF_CONFLICT');
  if(response.status!==200)throw failure('HANDOFF_SWITCH_UNKNOWN');
  const observed=await read();if(observed.port!==target)throw failure('HANDOFF_SWITCH_UNKNOWN');return observed;
 }};
}
