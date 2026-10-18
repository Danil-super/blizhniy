// Trusted repository plans only. Not an HTTP API and never invoked at app startup.
const invalid=()=>{throw Error('Restricted table privileges unavailable or unexpected');};
async function inspect(client,table,complete){
 const columns=(await client.query(`select a.attname as name,
  has_column_privilege('blizhniy_runtime',c.oid,a.attnum,'SELECT') as read,
  has_column_privilege('blizhniy_runtime',c.oid,a.attnum,'INSERT') as insert,
  has_column_privilege('blizhniy_runtime',c.oid,a.attnum,'UPDATE') as update,
  has_column_privilege('blizhniy_runtime',c.oid,a.attnum,'REFERENCES') as reference,
  (has_column_privilege('blizhniy_runtime',c.oid,a.attnum,'SELECT WITH GRANT OPTION') or
   has_column_privilege('blizhniy_runtime',c.oid,a.attnum,'INSERT WITH GRANT OPTION') or
   has_column_privilege('blizhniy_runtime',c.oid,a.attnum,'UPDATE WITH GRANT OPTION') or
   has_column_privilege('blizhniy_runtime',c.oid,a.attnum,'REFERENCES WITH GRANT OPTION')) as delegate
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='app' and c.relname=$1 and a.attnum>0 and not a.attisdropped`,[table.name])).rows;
 if(!columns.length)invalid();for(const column of columns){
  if(column.reference||column.delegate||column.insert&&!table.insert.includes(column.name)||column.update&&!table.update.includes(column.name))invalid();
  if(complete&&(!column.read||column.insert!==table.insert.includes(column.name)||column.update!==table.update.includes(column.name)))invalid();
 }
 const caps=(await client.query(`select has_table_privilege('blizhniy_runtime',c.oid,'DELETE') as delete,
  has_table_privilege('blizhniy_runtime',c.oid,'TRUNCATE') as truncate,has_table_privilege('blizhniy_runtime',c.oid,'TRIGGER') as trigger,
  has_table_privilege('blizhniy_runtime',c.oid,'MAINTAIN') as maintain,
  (has_table_privilege('blizhniy_runtime',c.oid,'SELECT WITH GRANT OPTION') or has_table_privilege('blizhniy_runtime',c.oid,'DELETE WITH GRANT OPTION')) as delegate
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and c.relname=$1`,[table.name])).rows[0];
 if(!caps||caps.truncate||caps.trigger||caps.maintain||caps.delegate||caps.delete&&!table.delete||complete&&caps.delete!==table.delete)invalid();
}
export async function applyRestrictedTableGrants(client,confirmation,plan){
 const {host,database}=client.connectionParameters;if(typeof confirmation!=='string'||confirmation!==`${host}:${database}`)throw Error('Missing or mismatched target confirmation');
 if(!Array.isArray(plan?.migrations)||!plan.migrations.length||!Array.isArray(plan.tables)||!plan.tables.length)invalid();
 for(const table of plan.tables)if(!/^[a-z][a-z0-9_]*$/.test(table.name)||typeof table.delete!=='boolean'||
  !['insert','update'].every(key=>Array.isArray(table[key])&&new Set(table[key]).size===table[key].length&&table[key].every(name=>typeof name==='string'&&/^[a-z][a-z0-9_]*$/.test(name))))invalid();
 let began=false;
 try{
  await client.query('begin');began=true;await client.query("set local lock_timeout='3s';set local statement_timeout='10s'");await client.query('select pg_advisory_xact_lock(187924,1)');
  const target=(await client.query("select current_database() as name,current_setting('server_version_num')::integer as version")).rows[0];
  if(target?.name!==database||target.version<180000||target.version>=190000)invalid();
  const history=(await client.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;if(JSON.stringify(history)!==JSON.stringify(plan.migrations))invalid();
  const role=(await client.query("select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname='blizhniy_runtime'")).rows[0];
  if(!role||Object.values(role).some(value=>value!==false))invalid();
  for(const table of plan.tables){
   await inspect(client,table,false);await client.query(`grant select on app.${table.name} to blizhniy_runtime`);
   if(table.insert.length)await client.query(`grant insert(${table.insert.join(',')}) on app.${table.name} to blizhniy_runtime`);
   if(table.update.length)await client.query(`grant update(${table.update.join(',')}) on app.${table.name} to blizhniy_runtime`);
   if(table.delete)await client.query(`grant delete on app.${table.name} to blizhniy_runtime`);await inspect(client,table,true);
  }
  await client.query('commit');began=false;return{tables:plan.tables.length};
 }catch(error){if(began)await client.query('rollback');throw error;}
}
