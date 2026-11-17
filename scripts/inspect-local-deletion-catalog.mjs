// Metadata inventory only; never deletes data or interprets JSON values.
import assert from 'node:assert/strict';import {createRequire} from 'node:module';import{pathToFileURL}from'node:url';import{join}from'node:path';import{readFile,writeFile,mkdtemp,chmod}from'node:fs/promises';
assert.deepEqual(process.argv.slice(2),['--run']);assert.equal(process.env.NODE_ENV,'test');
const root=process.cwd(),req=createRequire(join(root,'package.json')),pg=req('pg');
const {stateFile,stateDirectory,localPrimaryDatabaseConfig,docker}=await import(pathToFileURL(join(root,'scripts/local-primary-fixture.mjs'))),{readLocalPrimaryState,validateLocalPrimaryContainer}=await import(pathToFileURL(join(root,'scripts/local-primary-config.mjs')));
const state=readLocalPrimaryState(stateFile,root);validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const db=new pg.Client({...localPrimaryDatabaseConfig(state,'owner'),ssl:{ca:await readFile(join(stateDirectory,'refund-db-ca.pem'),'utf8'),rejectUnauthorized:true},statement_timeout:2000});
try{await db.connect();await db.query('begin isolation level repeatable read read only');
const journal=(await db.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;assert.equal(journal.length,59);
const adminJournal=(await db.query('select name,sha256 from app_admin.migrations')).rows;assert.equal(adminJournal.length,1);
const foreignKeys=(await db.query(`select n.nspname||'.'||t.relname as source,rn.nspname||'.'||r.relname as target,c.conname as name,
 array(select a.attname from unnest(c.conkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=t.oid and a.attnum=k.num order by ord) as columns,
 case c.confdeltype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end as on_delete
 from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace join pg_class r on r.oid=c.confrelid join pg_namespace rn on rn.oid=r.relnamespace
 where c.contype='f' and (n.nspname in('app','app_admin','local_primary') or rn.nspname in('app','app_admin')) order by 1,2,c.conname`)).rows;
const columns=(await db.query(`select n.nspname||'.'||c.relname as relation,a.attname as name,format_type(a.atttypid,a.atttypmod) as type from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid where n.nspname in('app','app_admin','local_primary') and c.relkind in('r','p') and a.attnum>0 and not a.attisdropped and (format_type(a.atttypid,a.atttypmod) in('json','jsonb','bytea') or a.attname ~ '(email|phone|contact|password|token|recipient|subject|payload)') order by 1,a.attnum`)).rows;
const identityColumns=(await db.query(`select n.nspname||'.'||c.relname as relation,a.attname as name,format_type(a.atttypid,a.atttypmod) as type,
 exists(select 1 from pg_constraint f where f.contype='f' and f.conrelid=c.oid and a.attnum=any(f.conkey) and f.confrelid='app.users'::regclass) as direct_user_fk
 from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid where n.nspname in('app','app_admin','local_primary') and c.relkind in('r','p') and a.attnum>0 and not a.attisdropped and a.attname in('owner_id','user_id','author_id','actor_id','target_id','operator_id','customer_id','recipient_id','applicant_id','guest_id','host_id','subject_id') order by 1,a.attnum`)).rows;
const triggers=(await db.query(`select n.nspname||'.'||c.relname as relation,t.tgname as name,pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('app','app_admin','local_primary') and not t.tgisinternal order by 1,2`)).rows;
await db.query('commit');
const reached=new Set(['app.users']);for(let n=-1;n!==reached.size;){n=reached.size;for(const edge of foreignKeys)if(reached.has(edge.target))reached.add(edge.source);}
const direct=foreignKeys.filter(row=>row.target==='app.users'),edges=foreignKeys.filter(row=>reached.has(row.source)&&reached.has(row.target));
const directory=await mkdtemp(join(stateDirectory,'deletion-inventory61-'));await chmod(directory,0o700);
const report={version:1,date:new Date().toISOString(),project:root,mainJournal:journal,adminJournal,direct,dependentRelations:[...reached].sort(),foreignKeys:edges,potentialSensitiveColumns:columns,identityColumns,triggers:triggers.filter(row=>reached.has(row.relation)||row.relation==='app_admin.user_changes'),method:'read-only catalogs; no user rows or JSON values inspected',deletionExecuted:false,productionTouched:false};
await writeFile(join(directory,'catalog.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({report:join(directory,'catalog.json'),directForeignKeys:direct.length,dependentRelations:reached.size,dependentEdges:edges.length,identityColumnsWithoutUserFk:identityColumns.filter(row=>!row.direct_user_fk).length,directDeleteActions:direct.reduce((all,row)=>(all[row.on_delete]=(all[row.on_delete]??0)+1,all),{}),deletionExecuted:false}));
}finally{await db.end();}
