import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute} from 'node:path';
export const localPrimaryImage='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
export function validateLocalPrimaryState(state,project){
 const keys=['version','project','origin','upstreamPort','containerId','containerName','dbPort','database','runtimePassword','ownerPassword','rateSecret'];
 if(!state||Object.keys(state).sort().join()!==keys.sort().join()||state.version!==1||state.project!==project||!isAbsolute(project)||
  !/^https:\/\/127\.0\.0\.1:\d{4,5}$/.test(state.origin)||new URL(state.origin).port===String(state.upstreamPort)||
  ![state.upstreamPort,state.dbPort,Number(new URL(state.origin).port)].every(n=>Number.isInteger(n)&&n>=1024&&n<=65535)||
  !/^[a-f0-9]{64}$/.test(state.containerId)||!/^blizhniy-primary-local-[a-f0-9]{12}$/.test(state.containerName)||
  state.database!=='blizhniy_prod'||![state.runtimePassword,state.ownerPassword,state.rateSecret].every(s=>/^[a-f0-9]{64}$/.test(s))||
  new Set([state.runtimePassword,state.ownerPassword,state.rateSecret]).size!==3)throw Error('Invalid owned local primary state');
 return state;
}
export function readLocalPrimaryState(file,project){
 if(!isAbsolute(file))throw Error('Local primary state must be absolute');
 for(const [path,mode,directory] of [[dirname(file),0o700,true],[file,0o600,false]]){
  const info=lstatSync(path);
  if(info.uid!==process.getuid()||(info.mode&0o777)!==mode||realpathSync(path)!==path||
   (directory?!info.isDirectory():!info.isFile()||info.size>8192||info.nlink!==1))throw Error('Unsafe local primary state');
 }
 return validateLocalPrimaryState(JSON.parse(readFileSync(file,'utf8')),project);
}
export function validateLocalPrimaryContainer(metadata,state){
 const ports=metadata?.NetworkSettings?.Ports;
 if(metadata?.Id!==state.containerId||metadata.Name!=='/'+state.containerName||metadata.Config?.Image!==localPrimaryImage||
  metadata.Config?.Labels?.['blizhniy.primary-local']!==state.project||Object.keys(ports??{}).join()!=='5432/tcp'||
  ports['5432/tcp']?.length!==1||ports['5432/tcp'][0].HostIp!=='127.0.0.1'||ports['5432/tcp'][0].HostPort!==String(state.dbPort))throw Error('Foreign or exposed local primary container');
 return state.containerId;
}
// A stopped Docker container has no live Ports map. Check its immutable owned
// definition before starting it, then require the full live-port check above.
export function validateLocalPrimaryContainerDefinition(metadata,state){
 const bindings=metadata?.HostConfig?.PortBindings,port=bindings?.['5432/tcp'];
 if(metadata?.Id!==state.containerId||metadata.Name!=='/'+state.containerName||metadata.Config?.Image!==localPrimaryImage||
  metadata.Config?.Labels?.['blizhniy.primary-local']!==state.project||!['default','bridge'].includes(metadata.HostConfig?.NetworkMode)||
  Object.keys(bindings??{}).join()!=='5432/tcp'||!Array.isArray(port)||port.length!==1||
  port[0].HostIp!=='127.0.0.1'||port[0].HostPort!=='')throw Error('Foreign or exposed local primary definition');
 return state.containerId;
}
