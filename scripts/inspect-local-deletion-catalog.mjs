// Metadata inventory only; never deletes data or interprets JSON values.
import assert from 'node:assert/strict';import {createRequire} from 'node:module';import{pathToFileURL}from'node:url';import{join}from'node:path';import{readFile,writeFile,mkdtemp,chmod}from'node:fs/promises';
import {getUserAccessRolePlan} from './user-access-role.mjs';
import {assertRefundSchema,readRefundSchema} from './refund-worker-schema.mjs';
assert.deepEqual(process.argv.slice(2),['--run']);assert.equal(process.env.NODE_ENV,'test');
const root=process.cwd(),req=createRequire(join(root,'package.json')),pg=req('pg');
const {stateFile,stateDirectory,localPrimaryDatabaseConfig,docker}=await import(pathToFileURL(join(root,'scripts/local-primary-fixture.mjs'))),{readLocalPrimaryState,validateLocalPrimaryContainer}=await import(pathToFileURL(join(root,'scripts/local-primary-config.mjs')));
const state=readLocalPrimaryState(stateFile,root);validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const db=new pg.Client({...localPrimaryDatabaseConfig(state,'owner'),ssl:{ca:await readFile(join(stateDirectory,'refund-db-ca.pem'),'utf8'),rejectUnauthorized:true},statement_timeout:2000});
try{await db.connect();await db.query('begin isolation level repeatable read read only');
const identity=(await db.query("select current_database() as database,current_setting('transaction_read_only') as readonly,(select ssl from pg_stat_ssl where pid=pg_backend_pid()) as ssl")).rows[0];
assert.deepEqual(identity,{database:state.database,readonly:'on',ssl:true});
const plan=getUserAccessRolePlan(state.database,{tariffs:true});
const journal=(await db.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;assert.deepEqual(journal,plan.appJournal);
const adminJournal=(await db.query('select name,sha256 from app_admin.migrations order by name')).rows;assert.deepEqual(adminJournal,plan.journal);
await assertRefundSchema(db,60,{localPrimary:true});
assert.deepEqual(await readRefundSchema(db,{namespace:'app_admin'}),JSON.parse(await readFile(new URL('../database/admin-user-access-schema-v2.json',import.meta.url),'utf8')));
// Aggregate counters and configuration can lack both identity columns and user FKs.
const relations=(await db.query(`select n.nspname||'.'||c.relname as relation
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p') and n.nspname in ('app','app_admin','local_primary') order by 1`)).rows.map(row=>row.relation);
const foreignKeys=(await db.query(`select n.nspname||'.'||t.relname as source,rn.nspname||'.'||r.relname as target,c.conname as name,
 array(select a.attname from unnest(c.conkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=t.oid and a.attnum=k.num order by ord) as columns,
 case c.confdeltype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end as on_delete
 from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace join pg_class r on r.oid=c.confrelid join pg_namespace rn on rn.oid=r.relnamespace
 where c.contype='f' and (n.nspname in('app','app_admin','local_primary') or rn.nspname in('app','app_admin')) order by 1,2,c.conname`)).rows;
const columns=(await db.query(`select n.nspname||'.'||c.relname as relation,a.attname as name,format_type(a.atttypid,a.atttypmod) as type from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid where n.nspname in('app','app_admin','local_primary') and c.relkind in('r','p') and a.attnum>0 and not a.attisdropped and (a.atttypid in ('text'::regtype,'varchar'::regtype,'json'::regtype,'jsonb'::regtype,'bytea'::regtype) or a.attname ~ '(email|phone|contact|password|token|recipient|subject|payload)') order by 1,a.attnum`)).rows;
const identityColumns=(await db.query(`select n.nspname||'.'||c.relname as relation,a.attname as name,format_type(a.atttypid,a.atttypmod) as type,
 exists(select 1 from pg_constraint f where f.contype='f' and f.conrelid=c.oid and a.attnum=any(f.conkey) and f.confrelid='app.users'::regclass) as direct_user_fk
 from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid where n.nspname in('app','app_admin','local_primary') and c.relkind in('r','p') and a.attnum>0 and not a.attisdropped and a.atttypid='uuid'::regtype order by 1,a.attnum`)).rows;
const triggers=(await db.query(`select n.nspname||'.'||c.relname as relation,t.tgname as name,pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('app','app_admin','local_primary') and not t.tgisinternal order by 1,2`)).rows;
// These references are outside the old name filter and the users FK closure.
assert.ok(identityColumns.some(row=>row.relation==='app_admin.tariff_changes'&&row.name==='actor_id'&&!row.direct_user_fk));
assert.ok(identityColumns.some(row=>row.name==='cancelled_by'&&row.direct_user_fk));
assert.ok(columns.some(row=>row.relation==='app_admin.tariff_changes'&&row.name==='reason'));
assert.ok(triggers.some(row=>row.relation==='app_admin.tariff_changes'&&row.name==='admin_tariff_changes_immutable'));
await db.query('commit');
const reached=new Set(['app.users']);for(let n=-1;n!==reached.size;){n=reached.size;for(const edge of foreignKeys)if(reached.has(edge.target))reached.add(edge.source);}
const direct=foreignKeys.filter(row=>row.target==='app.users'),edges=foreignKeys.filter(row=>reached.has(row.source)&&reached.has(row.target));
const directory=await mkdtemp(join(stateDirectory,'deletion-inventory62-'));await chmod(directory,0o700);
const report={version:2,relations,date:new Date().toISOString(),project:root,mainJournal:journal,adminJournal,direct,dependentRelations:[...reached].sort(),foreignKeys:edges,potentialSensitiveColumns:columns,identityColumns,triggers,method:'read-only catalogs; all text/JSON/bytea and UUID columns are candidates, not proven user references; no user rows or values inspected',deletionExecuted:false,productionTouched:false};
await writeFile(join(directory,'catalog.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({report:join(directory,'catalog.json'),tableCount:relations.length,directForeignKeys:direct.length,dependentRelations:reached.size,dependentEdges:edges.length,identityColumnsWithoutUserFk:identityColumns.filter(row=>!row.direct_user_fk).length,directDeleteActions:direct.reduce((all,row)=>(all[row.on_delete]=(all[row.on_delete]??0)+1,all),{}),deletionExecuted:false}));
}finally{await db.end();}
