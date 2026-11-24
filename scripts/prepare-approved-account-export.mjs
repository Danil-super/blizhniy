import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { lstat, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import pg from 'pg';
import { prepareApprovedProductionAccountExport } from './account-export-snapshot.mjs';
import { localArchiveMaximumBytes, readBoundedExportFile, readPrivateFile, validateLocalExportNotice } from './local-account-export-delivery.mjs';
import { packReviewedAccountReport } from './local-account-export-report.mjs';

const load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
const {deletionObject}=load('account-deletion-contract');
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

async function main(){
 const reviewed=process.argv.length===3&&process.argv[2]==='--reviewed-case';
 assert.ok(reviewed||process.argv.length===2);
 assert.equal(process.env.NODE_ENV,'production');
 const outputRoot='/run/blizhniy-account-export-work',mediaRoot='/var/lib/blizhniy-web/media';
 load('media-runtime-policy').assertMediaRuntime(process,mediaRoot);
 process.env.PLAYWRIGHT_BROWSERS_PATH=fileURLToPath(new URL('../browser',import.meta.url));

 let size=0;
 const chunks=[];
 for await(const chunk of process.stdin){
  size+=chunk.length;
  assert.ok(size<=(reviewed?512:65536));
  chunks.push(chunk);
 }
 let input=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
 let environment=process.env;
 if(reviewed){
  const directory=process.env.CREDENTIALS_DIRECTORY;
  assert.ok(directory&&dirname(directory)==='/run/credentials'&&
   /^blizhniy-account-export-prepare@[^/]+\.service$/.test(basename(directory)));
  const info=await lstat(directory);
  assert.ok(info.isDirectory()&&info.uid===0&&info.gid===0&&[0o500,0o550].includes(info.mode&0o7777));
  const credential=async name=>{
   const bytes=await readBoundedExportFile(join(directory,name),65536,stat=>
    stat.uid===0&&stat.gid===0&&stat.nlink===1&&[0o400,0o440].includes(stat.mode&0o7777));
   assert.ok(bytes);
   return bytes.toString('utf8');
  };
  input=bindReviewedAccountExport(input,JSON.parse(await credential('case.json')));
  environment={...parseEnv(await credential('reader.env')),NODE_ENV:'production'};
 }
 assert.match(environment.BLIZHNIY_AUTH_RATE_SECRET,/^[a-f0-9]{64}$/);
 const {readPostgresConfig,PostgresDatabase}=load('postgres');
 const config=readPostgresConfig(environment);
 assert.ok(config.database==='blizhniy_prod'&&config.user==='blizhniy_account_export_reader'&&config.ssl?.rejectUnauthorized===true);
 const db=new PostgresDatabase(new pg.Pool({...config,max:1,application_name:'blizhniy-approved-account-export'}));
 try{
  const prepared=await prepareOperatorArchive(db,input,{outputRoot,mediaRoot,listingViewRateSecret:environment.BLIZHNIY_AUTH_RATE_SECRET});
  if(reviewed){
   console.error(JSON.stringify({event:'approved_account_archive_prepared',directory:prepared.directory}));
   console.log('prepared');
  }else console.log(JSON.stringify(prepared));
 }finally{await db.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{await main();}catch{
  console.error('Approved account archive was not prepared.');
  process.exitCode=1;
 }
}
