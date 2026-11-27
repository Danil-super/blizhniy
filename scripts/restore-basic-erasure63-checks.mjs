// Dormant restore drill helper. Caller proves an owned disposable target, offline, first.
import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{createHash}from'node:crypto';
import{getUserAccessRolePlan}from'./user-access-role.mjs';import{assertBasicErasureProfile,inspectBasicErasureFixture,readBasicErasureSchema}from'./basic-account-erasure.mjs';
export async function restoreBasicErasure63Checks(db,containerId){
 try{
  assert.equal(process.env.NODE_ENV,'test');
  const owned=containerId===undefined?null:await inspectBasicErasureFixture(containerId);
  await db.transaction(async tx=>{
   await tx.query("select set_config('statement_timeout','3s',true),set_config('lock_timeout','2s',true),set_config('transaction_timeout','10s',true)");
   const context=(await tx.query("select current_database() as database,current_user as role,session_user as login,current_setting('transaction_read_only') as readonly,current_setting('session_replication_role') as replication,current_setting('blizhniy.erasure_fixture',true) as fixture")).rows[0];
   assert.equal(context?.database,'blizhniy_erasure_test');assert.equal(context.role,'postgres');assert.equal(context.login,'postgres');assert.equal(context.readonly,'off');assert.equal(context.replication,'origin');assert.match(context.fixture,/^blizhniy-erasure-[a-f0-9]{12}$/);
   const repair=async()=>{
    await tx.query("select set_config('blizhniy.restore_basic63','owned-basic63',true)");
    await tx.query(await readFile(new URL('../database/restore/basic-erasure63-checks.sql',import.meta.url),'utf8'));
   };
   if(owned){
    const {rows:[address]}=await tx.query('select host(inet_server_addr()) as address,inet_server_port() as port');
    assert.deepEqual({fixture:context.fixture,...address},owned);
    await assertBasicErasureProfile(tx,context.database,3,true);
    await repair();
    await assertBasicErasureProfile(tx,context.database,3);
    return;
   }
   const plan=getUserAccessRolePlan(context.database,{tariffs:true}),expected=JSON.parse(await readFile(new URL('../database/basic-account-erasure-schema63.json',import.meta.url),'utf8'));
   const migration=await readFile(new URL('../database/candidates/0063-basic-account-erasure.sql',import.meta.url));assert.equal(createHash('sha256').update(migration).digest('hex'),expected.migrationSha256);
   assert.deepEqual((await tx.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows,plan.appJournal);
   assert.deepEqual((await tx.query('select name,sha256 from app_admin.migrations order by name')).rows,[...plan.journal,{name:'0063-basic-account-erasure.sql',sha256:expected.migrationSha256}]);
   assert.deepEqual(await readBasicErasureSchema(tx),JSON.parse(await readFile(new URL('../database/basic-erasure-restored-schema63.json',import.meta.url),'utf8')));
   await repair();
   assert.deepEqual(await readBasicErasureSchema(tx),expected.schema);
  });
 }catch{throw Error('Basic63 restore preflight failed');}
}
