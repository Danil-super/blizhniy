import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { prepareApprovedProductionAccountExport } from './account-export-snapshot.mjs';
import { localArchiveMaximumBytes, readPrivateFile } from './local-account-export-delivery.mjs';
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

async function main(){
 assert.equal(process.argv.length,2);
 assert.equal(process.env.NODE_ENV,'production');
 const outputRoot='/run/blizhniy-account-export-work',mediaRoot='/var/lib/blizhniy-web/media';
 load('media-runtime-policy').assertMediaRuntime(process,mediaRoot);
 assert.match(process.env.BLIZHNIY_AUTH_RATE_SECRET,/^[a-f0-9]{64}$/);
 const {readPostgresConfig,PostgresDatabase}=load('postgres');
 const config=readPostgresConfig();
 assert.ok(config.database==='blizhniy_prod'&&config.user==='blizhniy_account_export_reader'&&config.ssl?.rejectUnauthorized===true);
 process.env.PLAYWRIGHT_BROWSERS_PATH=fileURLToPath(new URL('../browser',import.meta.url));

 let size=0;
 const chunks=[];
 for await(const chunk of process.stdin){
  size+=chunk.length;
  assert.ok(size<=65536);
  chunks.push(chunk);
 }
 const input=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
 const db=new PostgresDatabase(new pg.Pool({...config,max:1,application_name:'blizhniy-approved-account-export'}));
 try{
  const prepared=await prepareOperatorArchive(db,input,{outputRoot,mediaRoot,listingViewRateSecret:process.env.BLIZHNIY_AUTH_RATE_SECRET});
  console.log(JSON.stringify(prepared));
 }finally{await db.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{await main();}catch{
  console.error('Approved account archive was not prepared.');
  process.exitCode=1;
 }
}
