// Read-only inspection of one existing case, on the validated owned local stand only.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';import {join} from 'node:path';
import {pathToFileURL} from 'node:url';import {createRequire} from 'node:module';import pg from 'pg';
import {stateFile,stateDirectory,localPrimaryDatabaseConfig,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
import {getUserAccessRolePlan} from './user-access-role.mjs';import {assertRefundSchema,readRefundSchema} from './refund-worker-schema.mjs';
import {deletionId,deletionRevision} from '../src/lib/account-deletion-contract.ts';
import {inspectAccountDeletionCase} from '../src/lib/account-deletion-preflight.ts';

export async function inspectLocalDeletionCase(caseId,revision){
 assert.equal(process.env.NODE_ENV,'test');deletionId(caseId);deletionRevision(revision);
 assert.ok(process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'&&!Object.keys(process.env).some(key=>key.startsWith('PG')));
 const root=process.cwd(),state=readLocalPrimaryState(stateFile,root);
 validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
 const {PostgresDatabase}=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule('postgres');
 const db=new PostgresDatabase(new pg.Pool({...localPrimaryDatabaseConfig(state,'owner'),ssl:{ca:await readFile(join(stateDirectory,'refund-db-ca.pem'),'utf8'),rejectUnauthorized:true},max:1}));
 try{
  const result=await db.readTransaction(async tx=>{
   const connection=(await tx.query("select current_database() as database,current_user as role,session_user as login,current_setting('session_replication_role') as replication,(select ssl from pg_stat_ssl where pid=pg_backend_pid()) as ssl")).rows[0];
   assert.deepEqual(connection,{database:state.database,role:'postgres',login:'postgres',replication:'origin',ssl:true});const plan=getUserAccessRolePlan(state.database,{tariffs:true});
   assert.deepEqual((await tx.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows,plan.appJournal);
   assert.deepEqual((await tx.query('select name,sha256 from app_admin.migrations order by name')).rows,plan.journal);
   await assertRefundSchema(tx,60,{localPrimary:true});
   assert.deepEqual(await readRefundSchema(tx,{namespace:'app_admin'}),JSON.parse(await readFile(new URL('../database/admin-user-access-schema-v2.json',import.meta.url),'utf8')));
   return inspectAccountDeletionCase(tx,caseId,revision,{listingViewRateSecret:state.rateSecret});
  },{timeoutMs:5000});
  const directory=await mkdtemp(join(stateDirectory,'deletion-case62-'));
  const report=join(directory,'report.json');await writeFile(report,JSON.stringify({...result,project:root,productionTouched:false},null,2)+'\n',{mode:0o600,flag:'wx'});
  return{passed:true,decision:result.decision,blockers:result.blockers,retentionReview:result.retentionReview,executionAuthorized:false,report};
 }finally{await db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const args=process.argv.slice(2);assert.equal(args.length,5);assert.equal(args[0],'--run');assert.equal(args[1],'--request');assert.equal(args[3],'--revision');
  console.log(JSON.stringify(await inspectLocalDeletionCase(args[2],args[4])));
 }catch{console.error('Local deletion case inspection failed; no deletion performed.');process.exitCode=1;}
}
