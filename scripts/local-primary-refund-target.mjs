import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readLocalPrimaryState,validateLocalPrimaryContainerDefinition,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const execute=promisify(execFile),unavailable=()=>Error('Local refund target unavailable');
const docker=async args=>(await execute('/usr/bin/docker',['--host','unix:///var/run/docker.sock',...args],{timeout:5000,maxBuffer:131072,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}})).stdout;
/** Read-only physical target proof. The fixed public certificate is compared to the actual Pool config, not reopened later. */
export async function verifyLocalPrimaryRefundTarget(environment,{stateFile,project},run=docker){
 try{
  const env={...environment};
  if(typeof window!=='undefined'||env.BLIZHNIY_DB_HOST!=='127.0.0.1'||env.BLIZHNIY_DB_NAME!=='blizhniy_prod')throw unavailable();
  const state=readLocalPrimaryState(stateFile,project);if(env.BLIZHNIY_DB_PORT!==String(state.dbPort)||env.BLIZHNIY_DB_NAME!==state.database)throw unavailable();
  const rows=JSON.parse(await run(['inspect',state.containerId]));if(!Array.isArray(rows)||rows.length!==1||rows[0].State?.Running!==true)throw unavailable();
  validateLocalPrimaryContainerDefinition(rows[0],state);validateLocalPrimaryContainer(rows[0],state);
  const certificate=await run(['exec',state.containerId,'cat','/var/lib/postgresql/refund-server.crt']);
  if(typeof certificate!=='string'||Buffer.byteLength(certificate)>65536||!certificate.trim())throw unavailable();
  return certificate.trim();
 }catch{throw unavailable();}
}
export function assertLocalPrimaryRefundTrust(config,certificate){
 if(!config?.ssl||typeof config.ssl!=='object'||config.ssl.rejectUnauthorized!==true||typeof config.ssl.ca!=='string'||
  typeof certificate!=='string'||config.ssl.ca.trim()!==certificate.trim())throw unavailable();
}
