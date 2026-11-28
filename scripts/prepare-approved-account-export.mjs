import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { lstat, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import pg from 'pg';
import { prepareApprovedProductionAccountExport } from './account-export-snapshot.mjs';
import { localArchiveMaximumBytes, readBoundedExportFile, readPrivateFile, validateLocalExportNotice } from './local-account-export-delivery.mjs';
import { packReviewedAccountReport } from './local-account-export-report.mjs';

const load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
const {deletionId,deletionObject}=load('account-deletion-contract');
const {parseAdminPasskeyEnvelope,parseAdminPasskeyOptions,passkeyOperatorRequestLimit}=load('admin-passkey-contract');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function prepareOperatorArchive(db,input,{outputRoot,mediaRoot,listingViewRateSecret}){
 const {operatorToken,approval,disclosure}=deletionObject(input,['operatorToken','approval','disclosure']);
 assert.match(operatorToken,/^[a-f0-9]{64}$/);
 const prepared=await prepareApprovedProductionAccountExport(db,operatorToken,approval,{outputRoot,mediaRoot,listingViewRateSecret,disclosure});
 try{
  const bytes=await readPrivateFile(join(prepared.directory,'account.json'),localArchiveMaximumBytes);
  assert.ok(bytes);
  const {account}=JSON.parse(bytes.toString('utf8'));
  assert.equal(account.id,approval.ownerId);
  assert.equal(digest(account.email),approval.emailSha256);
  const archive=await packReviewedAccountReport(prepared.directory,outputRoot,account.id,account.email);
  await writeFile(join(prepared.directory,'archive.tar.gz'),archive,{flag:'wx',mode:0o600});
  for(const name of ['account.json','processing.json','report.pdf','media'])
   await rm(join(prepared.directory,name),{recursive:true});
  return{directory:basename(prepared.directory),archiveSha256:digest(archive),verifiedFiles:prepared.verifiedFiles};
 }catch(error){
  await rm(prepared.directory,{recursive:true,force:true});
  throw error;
 }
}

export function bindReviewedAccountExport(input,review){
 const {caseId,operatorToken}=deletionObject(input,['caseId','operatorToken']);
 const {approval,disclosure}=deletionObject(review,['approval','disclosure']);
 assert.match(caseId,/^[A-Za-z0-9_-]{6,80}$/);
 assert.equal(caseId,approval.caseId);
 return{operatorToken,approval,disclosure:validateLocalExportNotice(disclosure)};
}

function reviewPasskeyCommand(bound){
 const {caseId,ownerId,operatorId,emailSha256}=deletionObject(bound.approval,['caseId','ownerId','operatorId','emailSha256']);
 deletionId(ownerId);
 const expectedAdminId=deletionId(operatorId);
 assert.match(emailSha256,/^[a-f0-9]{64}$/);
 const disclosure=Object.keys(bound.disclosure).sort().map(key=>[key,bound.disclosure[key]]);
 return {caseId,expectedAdminId,reviewDigest:digest(JSON.stringify([ownerId,emailSha256,disclosure]))};
}

export async function reviewedAccountExportOptions(input,review,verify=load('admin-passkey-operator-client').callHostedAdminPasskey){
 const bound=bindReviewedAccountExport(input,review);
 const envelope=parseAdminPasskeyEnvelope({token:bound.operatorToken,command:{
  action:'archive-options',command:reviewPasskeyCommand(bound),
 }});
 return parseAdminPasskeyOptions(await verify(envelope.token,envelope.command));
}

export async function authorizeReviewedAccountExport(input,review,approve=load('admin-passkey-operator-client').callHostedAdminPasskey){
 const {caseId,operatorToken,credential}=deletionObject(input,['caseId','operatorToken','credential']);
 const bound=bindReviewedAccountExport({caseId,operatorToken},review);
 const envelope=parseAdminPasskeyEnvelope({token:operatorToken,command:{
  action:'archive-approve',command:reviewPasskeyCommand(bound),credential,
 }});
 const result=await approve(envelope.token,envelope.command);
 assert.equal(result.status,'approved');
 return bound;
}

async function main(){
 assert.ok(process.argv.length===3&&process.argv[2]==='--reviewed-case');
 assert.equal(process.env.NODE_ENV,'production');
 const outputRoot='/run/blizhniy-account-export-work',mediaRoot='/var/lib/blizhniy-web/media';
 load('media-runtime-policy').assertMediaRuntime(process,mediaRoot);
 process.env.PLAYWRIGHT_BROWSERS_PATH=fileURLToPath(new URL('../browser',import.meta.url));

 let size=0;
 const chunks=[];
 for await(const chunk of process.stdin){
  size+=chunk.length;
  assert.ok(size<=passkeyOperatorRequestLimit);
  chunks.push(chunk);
 }
 const frame=Buffer.concat(chunks,size);
 let request;
 try{request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(frame));}
 finally{frame.fill(0);for(const chunk of chunks)chunk.fill(0);}
 const directory=process.env.CREDENTIALS_DIRECTORY;
 assert.ok(directory&&dirname(directory)==='/run/credentials'&&
  /^blizhniy-account-export-prepare@[^/]+\.service$/.test(basename(directory)));
 const info=await lstat(directory);
 assert.ok(info.isDirectory()&&info.uid===0&&info.gid===0&&[0o500,0o550].includes(info.mode&0o7777));
 const credential=async name=>{
  const bytes=await readBoundedExportFile(join(directory,name),65536,stat=>
   stat.uid===0&&stat.gid===0&&stat.nlink===1&&[0o400,0o440].includes(stat.mode&0o7777));
  assert.ok(bytes);
  try{return bytes.toString('utf8');}finally{bytes.fill(0);}
 };
 const review=JSON.parse(await credential('case.json'));
 if(request?.action==='options'){
  const {caseId,operatorToken}=deletionObject(request,['action','caseId','operatorToken']);
  console.log(JSON.stringify(await reviewedAccountExportOptions({caseId,operatorToken},review)));
  return;
 }
 const {action,caseId,operatorToken,credential:assertion}=deletionObject(request,['action','caseId','operatorToken','credential']);
 assert.equal(action,'prepare');
 const input=await authorizeReviewedAccountExport({caseId,operatorToken,credential:assertion},review);
 const environment={...parseEnv(await credential('reader.env')),NODE_ENV:'production'};
 assert.match(environment.BLIZHNIY_AUTH_RATE_SECRET,/^[a-f0-9]{64}$/);
 const {readPostgresConfig,PostgresDatabase}=load('postgres');
 const config=readPostgresConfig(environment);
 assert.ok(config.database==='blizhniy_prod'&&config.user==='blizhniy_account_export_reader'&&config.ssl?.rejectUnauthorized===true);
 const db=new PostgresDatabase(new pg.Pool({...config,max:1,application_name:'blizhniy-approved-account-export'}));
 try{
  const prepared=await prepareOperatorArchive(db,input,{outputRoot,mediaRoot,listingViewRateSecret:environment.BLIZHNIY_AUTH_RATE_SECRET});
  console.error(JSON.stringify({event:'approved_account_archive_prepared',directory:prepared.directory}));
  console.log('prepared');
 }finally{await db.close();}
}

if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await main();}catch{
  console.error('Approved account archive was not prepared.');
  process.exitCode=1;
 }
}
