// Explicit approved LOCAL operator only; never imported by startup or deployment.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {getBootstrapPlan} from './postgres-migration-plan.mjs';

const name='0030-application-withdrawals.sql';
const grants='grant select on app.application_withdrawals to blizhniy_runtime;grant insert(application_id,owner_id,withdrawn_revision) on app.application_withdrawals to blizhniy_runtime';
export function getApplicationWithdrawalPlan(extras){
 const source=readFileSync(new URL('../database/migrations/'+name,import.meta.url),'utf8');
 const migration={name,source,sha256:createHash('sha256').update(source).digest('hex')};
 const unique=new Map();
 for(const row of [...getBootstrapPlan({includeListingContactMethod:true}),...extras,migration]){
  const previous=unique.get(row.name);
  if(previous)assert.equal(previous.sha256,row.sha256,'Conflicting migration hash');
  else unique.set(row.name,{name:row.name,sha256:row.sha256});
 }
 const migrations=[...unique.values()].sort((a,b)=>a.name.localeCompare(b.name));
 assert.equal(migrations.length,30,'Unexpected local migration manifest');
 assert.deepEqual(migrations.slice(-5).map(row=>row.name),['0026-listing-blocks.sql','0027-listing-owner-visibility.sql','0028-listing-restore-entitlement.sql','0029-listing-owner-removals.sql',name]);
 return{migration,migrations};
}

async function inspectRuntime(owner){
 const role=(await owner.query("select rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls from pg_roles where rolname='blizhniy_runtime'")).rows[0];
 assert.ok(role&&Object.values(role).every(value=>value===false),'Unexpected runtime authority');
 const memberships=(await owner.query("select 1 from pg_auth_members m join pg_roles r on r.oid=m.roleid or r.oid=m.member where r.rolname='blizhniy_runtime'")).rows;
 assert.equal(memberships.length,0,'Unexpected runtime membership');
}
async function inspectMarker(owner,complete){
 const relation=(await owner.query(`select c.relowner='blizhniy_runtime'::regrole as runtime_owner,
  t.tgenabled='A' and t.tgfoid='app.guard_application_withdrawal()'::regprocedure as guarded,p.prosecdef
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  join pg_trigger t on t.tgrelid=c.oid and t.tgname='application_withdrawal_guard'
  join pg_proc p on p.oid=t.tgfoid where n.nspname='app' and c.relname='application_withdrawals'`)).rows;
 assert.equal(relation.length,1,'Missing withdrawal guard');
 assert.deepEqual(relation[0],{runtime_owner:false,guarded:true,prosecdef:false});
 const columns=(await owner.query(`select attname as name,
  has_column_privilege('blizhniy_runtime',attrelid,attnum,'SELECT') as read,
  has_column_privilege('blizhniy_runtime',attrelid,attnum,'INSERT') as insert,
  has_column_privilege('blizhniy_runtime',attrelid,attnum,'UPDATE') as update,
  has_column_privilege('blizhniy_runtime',attrelid,attnum,'REFERENCES') as reference,
  (has_column_privilege('blizhniy_runtime',attrelid,attnum,'SELECT WITH GRANT OPTION') or
   has_column_privilege('blizhniy_runtime',attrelid,attnum,'INSERT WITH GRANT OPTION') or
   has_column_privilege('blizhniy_runtime',attrelid,attnum,'UPDATE WITH GRANT OPTION') or
   has_column_privilege('blizhniy_runtime',attrelid,attnum,'REFERENCES WITH GRANT OPTION')) as delegate
  from pg_attribute where attrelid='app.application_withdrawals'::regclass and attnum>0 and not attisdropped order by attnum`)).rows;
 assert.deepEqual(columns.map(row=>row.name),['application_id','owner_id','withdrawn_revision','withdrawn_at']);
 for(const column of columns){
  const insertable=column.name!=='withdrawn_at';
  assert.ok(!column.update&&!column.reference&&!column.delegate&&(!column.insert||insertable),'Unexpected marker privileges');
  if(complete)assert.ok(column.read&&column.insert===insertable,'Incomplete marker privileges');
 }
 const unsafe=(await owner.query(`select exists(select 1 from unnest(array['DELETE','TRUNCATE','TRIGGER','MAINTAIN']) capability
  where has_table_privilege('blizhniy_runtime','app.application_withdrawals',capability)) as present`)).rows[0];
 assert.equal(unsafe.present,false,'Unexpected marker table authority');
}

async function main(){
 const args=process.argv.slice(2);
 if(args.length!==1||!['--plan','--apply-local'].includes(args[0]))throw Error('Use --plan or explicitly approved --apply-local');
 const apply=args[0]==='--apply-local';
 // Delay fixture/pg imports until explicit CLI invocation; importing the
 // manifest helper needs neither credentials nor TypeScript nor a database.
 const {stateFile,localPrimaryDatabaseConfig,docker,getLocalPrimaryExtraMigrations}=await import('./local-primary-fixture.mjs');
 const {readLocalPrimaryState,validateLocalPrimaryContainer}=await import('./local-primary-config.mjs');
 const {default:pg}=await import('pg');
 const state=readLocalPrimaryState(stateFile,process.cwd());
 validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
 const plan=getApplicationWithdrawalPlan(await getLocalPrimaryExtraMigrations());
 const owner=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));
 await owner.connect();let began=false;
 try{
  await owner.query(apply?'begin':'begin read only');began=true;
  await owner.query("set local lock_timeout='3s';set local statement_timeout='10s'");
  if(apply){await owner.query('select pg_advisory_xact_lock(187924,30)');}
  const database=(await owner.query("select current_database() as name,current_setting('server_version_num')::integer as version")).rows[0];
  assert.ok(database.name===state.database&&database.version>=180000&&database.version<190000,'Unexpected local database');
  await inspectRuntime(owner);
  const journal=(await owner.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
  assert.ok(journal.length===29||journal.length===30,'Unexpected local journal length');
  assert.deepEqual(journal,plan.migrations.slice(0,journal.length));
  if(journal.length===29){
   assert.equal((await owner.query("select to_regclass('app.application_withdrawals') as marker")).rows[0].marker,null,'Unjournaled withdrawal table');
  }else await inspectMarker(owner,false);
  const target={host:'127.0.0.1',port:state.dbPort,database:state.database,container:state.containerName,origin:state.origin};
  if(!apply){
   await owner.query('commit');began=false;
   console.log(JSON.stringify({target,currentSchema:journal.length,migration:{name:plan.migration.name,sha256:plan.migration.sha256},grants,willApply:false,productionTouched:false}));
   return;
  }
  if(apply){
   if(journal.length===29){
    await owner.query(plan.migration.source.replace(/^begin;\r?\n/m,'').replace(/commit;\s*$/,''));
    await owner.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[plan.migration.name,plan.migration.sha256]);
   }
   await inspectMarker(owner,false);
   await owner.query(grants);
   await inspectMarker(owner,true);
   await inspectRuntime(owner);
   assert.deepEqual((await owner.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows,plan.migrations);
   await owner.query('commit');began=false;
   console.log(JSON.stringify({target,status:'applied',schema:30,productionTouched:false}));
  }
 }catch(error){if(began)await owner.query('rollback');throw error;}
 finally{await owner.end();}
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{
 console.error('Local application withdrawal operation failed; no automatic retry.');process.exitCode=1;
});
