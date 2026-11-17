import {mkdtemp,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {stateFile,stateDirectory} from './local-primary-fixture.mjs';
import {readLocalPrimaryState} from './local-primary-config.mjs';
import {readLocalUserAccessCredentials} from './local-user-access-credentials.mjs';
import {buildUserAccessOperator} from './build-user-access-operator.mjs';
const unavailable=()=>Error('Local user operator startup unavailable');
/** Explicit launcher capability only. The reviewed installer creates its role/credential first. */
export async function startLocalPrimaryUserAccess(signal){
 let directory,runtime,server,closing;
 try{
  if(!(signal instanceof AbortSignal)||process.env.NODE_ENV!=='test'||process.env.BLIZHNIY_LOCAL_PRIMARY!=='enabled'||process.env.BLIZHNIY_LOCAL_USER_ACCESS!=='enabled')throw unavailable();
  signal.throwIfAborted();const root=process.cwd(),state=readLocalPrimaryState(stateFile,root),credentials=readLocalUserAccessCredentials(join(stateDirectory,'user-access.json'),state);
  directory=await mkdtemp(join(stateDirectory,'user-operator-package-'));const destination=join(directory,'package');buildUserAccessOperator(destination);
  await symlink(join(root,'node_modules'),join(destination,'node_modules'),'dir');signal.throwIfAborted();
  const {createLocalUserAccessRuntime}=await import(pathToFileURL(join(destination,'scripts/local-user-access-runtime.mjs')));
  runtime=await createLocalUserAccessRuntime({NODE_ENV:'test',BLIZHNIY_DB_HOST:'127.0.0.1',BLIZHNIY_DB_PORT:String(state.dbPort),BLIZHNIY_DB_NAME:state.database,
   BLIZHNIY_DB_USER:'blizhniy_user_operator',BLIZHNIY_DB_PASSWORD:credentials.password,BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:join(stateDirectory,'refund-db-ca.pem')},{stateFile,project:root});
  signal.throwIfAborted();const {startLocalUserAccessOperator}=await import(pathToFileURL(join(destination,'scripts/local-user-access-operator.mjs')));
  const transferred=runtime;runtime=undefined;server=await startLocalUserAccessOperator(transferred);signal.throwIfAborted();
  return {socketPath:server.socketPath,done:server.done,close:()=>closing??=(async()=>{
   let failed=false;try{await server.close();}catch{failed=true;}
   try{await rm(directory,{recursive:true,force:true});}catch{failed=true;}if(failed)throw unavailable();
  })()};
 }catch{
  if(server)await Promise.allSettled([server.close()]);else if(runtime)await Promise.allSettled([runtime.close()]);
  if(directory)await Promise.allSettled([rm(directory,{recursive:true,force:true})]);throw unavailable();
 }
}
