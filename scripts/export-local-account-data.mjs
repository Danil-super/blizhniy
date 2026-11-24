// CLI for the owned synthetic stand.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {lstat,mkdtemp,readFile,mkdir,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {docker,localPrimaryDatabaseConfig,stateDirectory,stateFile} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
import {archiveRoot,localArchiveMaximumBytes,publishLocalAccountArchive,readBoundedExportFile,revokeLocalAccountArchive} from './local-account-export-delivery.mjs';
import {prepareLocalAccountEmail,readReviewedAccountReport,writeLocalAccountReport} from './local-account-export-report.mjs';
import {readAccountExport,verifiedOperator,writeAccountExportFiles} from './account-export-snapshot.mjs';

export {readAccountExport,readApprovedProductionAccountExport,prepareApprovedProductionAccountExport,
 writeAccountExportFiles} from './account-export-snapshot.mjs';

const load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
const {DeletionAccessError,deletionId}=load('account-deletion-contract');
const {hashSessionToken}=load('identity');

async function withLocalExportDatabase(work){
 assert.equal(process.env.NODE_ENV,'test');
 const info=await lstat(stateDirectory);
 assert.ok(info.isDirectory()&&info.uid===process.getuid()&&(info.mode&0o777)===0o700&&await realpath(stateDirectory)===stateDirectory);
 const state=readLocalPrimaryState(stateFile,process.cwd());
 validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
 const {PostgresDatabase}=load('postgres');
 const ca=await readFile(join(stateDirectory,'refund-db-ca.pem'));
 const db=new PostgresDatabase(new pg.Pool({...localPrimaryDatabaseConfig(state,'owner'),ssl:{ca,rejectUnauthorized:true},max:1}));
 try{return await work(db,state);}
 finally{await db.close();}
}

async function writeLocalExport(ownerId,token,notice){
 const {data,state}=await withLocalExportDatabase(async(db,state)=>({
  data:await readAccountExport(db,token,ownerId,undefined,{listingViewRateSecret:state.rateSecret}),state,
 }));
 const directory=await mkdtemp(join(stateDirectory,'account-export-'));
 try{
  const verifiedFiles=await writeAccountExportFiles(data,directory,join(stateDirectory,'media'),notice?localArchiveMaximumBytes:Infinity);
  if(notice){
   const delivery=archiveRoot(stateDirectory,state.containerId);
   await mkdir(delivery,{recursive:true,mode:0o700});
   const receipt=await publishLocalAccountArchive(directory,delivery,ownerId,notice);
   await rm(directory,{recursive:true});
   return {...receipt,verifiedFiles};
  }
  return {directory,verifiedFiles};
 }catch(error){
  await rm(directory,{recursive:true,force:true});
  throw error;
 }
}

async function runOperatorExport([operatorFlag,operator,ownerFlag,owner,action,value,caseId],token){
 assert.equal(operatorFlag,'--operator');assert.equal(ownerFlag,'--owner');
 const operatorId=deletionId(operator),ownerId=deletionId(owner);
 if(action==='--prepare'){
  const notice=await readExportNotice(value);
  const data=await withLocalExportDatabase((db,state)=>readAccountExport(db,token,ownerId,operatorId,{listingViewRateSecret:state.rateSecret}));
  assert.ok(data.account.email.endsWith('.invalid'));
  const directory=await mkdtemp(join(stateDirectory,'account-export-reviewed-'));
  try{
   const verifiedFiles=await writeAccountExportFiles(data,directory,join(stateDirectory,'media'),localArchiveMaximumBytes);
   await writeLocalAccountReport(directory,data,caseId,notice);
   return {directory,report:'report.pdf',verifiedFiles};
  }catch(error){await rm(directory,{recursive:true,force:true});throw error;}
 }
 assert.ok(['--cabinet','--email','--revoke'].includes(action)&&caseId===undefined);
 const hash=hashSessionToken(token);
 if(!hash)throw new DeletionAccessError();
 const {email,state}=await withLocalExportDatabase(async(db,state)=>{
  const account=await db.readTransaction(async tx=>(await tx.query('select u.email '+verifiedOperator,
   [hash,ownerId,operatorId])).rows[0],{timeoutMs:5000});
  if(!account?.email.endsWith('.invalid'))throw new DeletionAccessError();
  return {email:account.email,state};
 });
 const delivery=archiveRoot(stateDirectory,state.containerId);
 if(action==='--revoke')return {revoked:await revokeLocalAccountArchive(delivery,ownerId,value)};
 const notice=await readReviewedAccountReport(value,stateDirectory,ownerId,email);
 if(action==='--email')return prepareLocalAccountEmail(value,stateDirectory,email);
 await mkdir(delivery,{recursive:true,mode:0o700});
 return publishLocalAccountArchive(value,delivery,ownerId,notice,true);
}

async function readExportNotice(path){
 const bytes=await readBoundedExportFile(path,32768);
 assert.ok(bytes);
 const notice=JSON.parse(bytes.toString('utf8'));
 assert.ok(notice&&typeof notice==='object');
 return notice;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  let token='';
  process.stdin.setEncoding('utf8');
  for await(const chunk of process.stdin){token+=chunk;if(token.length>65)throw new DeletionAccessError();}
  if(process.argv[2]==='--operator'){
   assert.ok(process.argv.length===8||process.argv.length===9);
   console.log(JSON.stringify(await runOperatorExport(process.argv.slice(2),token.trimEnd())));
  }else{
  assert.ok(process.argv.length===4||process.argv.length===6&&process.argv[4]==='--delivery-notice');
  assert.equal(process.argv[2],'--owner');
  const notice=process.argv[5]?await readExportNotice(process.argv[5]):undefined;
  console.log(JSON.stringify(await writeLocalExport(deletionId(process.argv[3]),token.trimEnd(),notice)));
  }
 }catch{console.error('Local account export failed');process.exitCode=1;}
}
