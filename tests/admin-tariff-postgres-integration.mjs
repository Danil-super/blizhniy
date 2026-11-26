// Opt-in disposable PG18 only; no permanent stand/config/role installation.
import assert from 'node:assert/strict';import {test} from 'node:test';import{execFile}from'node:child_process';import{promisify}from'node:util';import{randomUUID,randomBytes,createHash}from'node:crypto';import{readFile}from'node:fs/promises';import{createRequire}from'node:module';import pg from 'pg';
import{getReferenceSeed}from'../scripts/bootstrap-postgres.mjs';
import{getRefundWorkerRolePlan}from'../scripts/refund-worker-role.mjs';import{readRefundSchema}from'../scripts/refund-worker-schema.mjs';
const run=promisify(execFile),password=randomBytes(32).toString('hex'),rolePassword=randomBytes(32).toString('hex'),name='blizhniy-tariff-test-'+randomBytes(6).toString('hex'),label='blizhniy.tariff-test';
const docker=async args=>(await run('docker',['--host','unix:///var/run/docker.sock',...args],{env:{PATH:process.env.PATH,LANG:'C.UTF-8',POSTGRES_PASSWORD:password},timeout:20000,maxBuffer:1048576})).stdout.trim();
const {loadLocalPrimaryModule:load}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs'),hash=value=>createHash('sha256').update(value).digest('hex');
const signature='app_admin.tariff_access(text,uuid,text,text,uuid,text,text,text,integer,boolean,text)';
test('admin tariffs use atomic exact-price CAS and receipts through EXECUTE-only authority',{timeout:90000},async suite=>{
 let container,owner,operator,ownerDb;
 try{
  container=await docker(['run','--detach','--pull','never','--name',name,'--label',label+'='+name,'--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_prod','postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873']);
  assert.match(container,/^[a-f0-9]{64}$/);const meta=JSON.parse(await docker(['inspect',container]))[0];assert.equal(meta.Config.Labels[label],name);const bind=meta.NetworkSettings.Ports['5432/tcp'][0];assert.equal(bind.HostIp,'127.0.0.1');
  for(const deadline=Date.now()+20000;;){try{await docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']);break;}catch{assert.ok(Date.now()<deadline);}await new Promise(resolve=>setTimeout(resolve,100));}
  const config={host:'127.0.0.1',port:Number(bind.HostPort),database:'blizhniy_prod',user:'postgres',password,ssl:false,connectionTimeoutMillis:2000};owner=new pg.Client(config);await owner.connect();
  await owner.query('create schema blizhniy_meta;create table blizhniy_meta.migrations(name text primary key,sha256 text not null);revoke all on schema blizhniy_meta from public');
  for(const row of getRefundWorkerRolePlan('blizhniy_prod',{schema:60,localPrimary:true}).journal){await owner.query(await readFile(new URL('../database/'+(/^(0058|0060)-/.test(row.name)?'candidates/':'migrations/')+row.name,import.meta.url),'utf8'));await owner.query('insert into blizhniy_meta.migrations values($1,$2)',[row.name,row.sha256]);}
  await owner.query('create role blizhniy_runtime nologin');for(const file of ['permissions/telegram-phone.sql','local-primary-payment.sql','local-primary-refunds.sql'])await owner.query(await readFile(new URL('../database/'+file,import.meta.url),'utf8'));
  await owner.query(await readFile(new URL('../database/candidates/0061-admin-user-access.sql',import.meta.url),'utf8'));
  await owner.query('begin read only');const before=await readRefundSchema(owner);await owner.query('rollback');
  await owner.query(await readFile(new URL('../database/candidates/0062-admin-tariffs.sql',import.meta.url),'utf8'));
  await owner.query('begin read only');assert.deepEqual(await readRefundSchema(owner),before);await owner.query('rollback');
  await owner.query('create role blizhniy_user_operator login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 4 password '+pg.escapeLiteral(rolePassword));
  await owner.query('revoke all on database blizhniy_prod from public;grant connect on database blizhniy_prod to blizhniy_user_operator;grant usage on schema app_admin to blizhniy_user_operator;grant execute on function '+signature+' to blizhniy_user_operator');
  operator=new pg.Pool({...config,user:'blizhniy_user_operator',password:rolePassword,max:3,statement_timeout:4000,lock_timeout:1000});
  const {PostgresDatabase}=load('postgres'),{PostgresAdminTariffs}=load('postgres-admin-tariffs');const store=new PostgresAdminTariffs(new PostgresDatabase(operator));
  const account=async role=>{const id=randomUUID();await owner.query('insert into app.users(id,email,password_hash,role,email_verified_at) values($1,$2,$3,$4,clock_timestamp())',[id,id+'@example.invalid','scrypt$131072$8$1$'+'0'.repeat(32)+'$'+'0'.repeat(128),role]);return id;};
  const session=async id=>{const token=randomBytes(32).toString('hex');await owner.query("insert into app.sessions(token_hash,user_id,auth_version,expires_at) select $1,id,auth_version,clock_timestamp()+interval '1 hour' from app.users where id=$2",[hash(token),id]);return token;};
  await owner.query('insert into app.tariffs(id,action,name,price,duration_days,active) select id,action,name,price,duration_days,active from jsonb_to_recordset($1::jsonb) x(id text,action text,name text,price numeric,duration_days integer,active boolean)',[JSON.stringify(getReferenceSeed().tariffs)]);
  const actor=await account('admin'),peer=await account('admin'),ordinary=await account('user'),token=await session(actor),peerToken=await session(peer),ordinaryToken=await session(ordinary);
  ownerDb=new PostgresDatabase(new pg.Pool({...config,max:2}));const intents=new(load('postgres-payment-intents').PostgresPaymentIntentStore)(ownerDb);
  const frozen={id:randomUUID(),ownerId:ordinary,targetType:'listing',targetId:randomUUID(),targetRevision:'1',tariffId:'listing-publication',amount:'199.00',durationDays:30,shopId:'fixture-shop',isTest:true};
  const requestBody=JSON.stringify({amount:{value:frozen.amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://site.example.invalid/oplata/'+frozen.id},metadata:{localPaymentId:frozen.id,targetId:frozen.targetId,targetType:frozen.targetType,tariffId:frozen.tariffId},receipt:{customer:{email:ordinary+'@example.invalid'},internet:true,items:[{amount:{value:frozen.amount,currency:'RUB'},description:'Исходное размещение',payment_mode:'full_payment',payment_subject:'service',quantity:1,vat_code:1}]}});
  await ownerDb.transaction(tx=>intents.persistInTransaction(tx,{...frozen,requestBody}));
  await owner.query('insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,$4,$5,$6)',[frozen.id,ordinary,randomUUID(),'listing',frozen.targetId,'1']);
  const financialBefore=(await owner.query('select to_jsonb(i) intent,to_jsonb(o) purchase from app.payment_checkout_intents i join app.payment_orders o using(id) where i.id=$1',[frozen.id])).rows[0];
  assert.equal((await intents.authorize(frozen)).requestBody,requestBody);const providerId=randomUUID();await intents.bindProvider(frozen,providerId);
  const list=(t=token,a=actor)=>store.execute(t,{resource:'tariffs',action:'list',expectedAdminId:a});
  const change=(row,patch={},op=randomUUID(),t=token,a=actor)=>store.execute(t,{resource:'tariffs',action:'change',expectedAdminId:a,input:{id:op,tariffId:row.id,expectedRevision:row.revision,name:row.name,price:row.price,durationDays:row.durationDays,active:row.active,reason:'Локальная проверка цены',...patch}});
  const find=async()=>{const data=await list();const row=data.tariffs.find(row=>row.id==='listing-publication');assert.ok(row);return row;};
  await suite.test('role cannot read tariffs/audit/users directly, write prices or call helper; old app unchanged',async()=>{
   for(const sql of ['select * from app.tariffs','update app.tariffs set price=1 where false','select * from app_admin.tariff_changes','truncate app_admin.tariff_changes','select * from app.users'])await assert.rejects(operator.query(sql),error=>error.code==='42501');
   const row=(await owner.query('select prosecdef,proconfig,has_function_privilege(\'public\',$1,\'EXECUTE\') public_execute from pg_proc where oid=$1::regprocedure',[signature])).rows[0];assert.equal(row.prosecdef,true);assert.equal(row.public_execute,false);assert.ok(row.proconfig.includes('search_path=pg_catalog, pg_temp'));
   await assert.rejects(list(ordinaryToken,ordinary),error=>error.code==='ADMIN_REQUIRED');await assert.rejects(list(token,peer),error=>error.code==='ADMIN_REQUIRED');
  });
  await suite.test('authorized SQL result matches the public contract',async()=>{
   const command={resource:'tariffs',action:'list',expectedAdminId:actor};
   const {rows}=await operator.query('select app_admin.tariff_access($1,$2,$3,null,null,null,null,null,null,null,null) as result',[hash(token),actor,'list']);
   load('admin-tariff-contract').parseAdminTariffResult(command,rows[0].result);
  });
  let original,first;
  await suite.test('exact kopeks, one receipt, payload binding and current version conflict',async()=>{
   original=await find();const id=randomUUID();first=await change(original,{price:'249.51'},id);assert.equal(first.tariffs[0].price,'249.51');assert.equal(first.receipt.previous.price,original.price);assert.equal(first.receipt.changed,true);
   const again=await change(original,{price:'249.51'},id);assert.deepEqual(again.receipt,first.receipt);assert.equal(again.history.length,1);
   await assert.rejects(change(original,{price:'249.52'},id),error=>error.code==='OPERATION_CONFLICT');await assert.rejects(change(original,{price:'249.52'}),error=>error.code==='STALE_TARIFF');
   assert.equal((await owner.query("select price::text from app.tariffs where id='listing-publication'")).rows[0].price,'249.51');
  });
  await suite.test('A-B-A is a new revision; no-op does not bump; old recovery/replay never reapplies',async()=>{
   const reset=await change(first.tariffs[0],{price:original.price});assert.notEqual(reset.tariffs[0].revision,original.revision);await assert.rejects(change(original,{name:'Устаревший редактор'}),error=>error.code==='STALE_TARIFF');
   const noop=await change(reset.tariffs[0]);assert.equal(noop.receipt.changed,false);assert.equal(noop.tariffs[0].revision,reset.tariffs[0].revision);
   const recovered=await store.execute(token,{resource:'tariffs',action:'recover',expectedAdminId:actor,tariffId:original.id,id:first.receipt.id});assert.deepEqual(recovered.receipt,first.receipt);assert.equal(recovered.tariffs[0].price,original.price);
   const replay=await change(original,{price:'249.51'},first.receipt.id);assert.deepEqual(replay.receipt,first.receipt);assert.equal(replay.tariffs[0].price,original.price);
   await assert.rejects(store.execute(peerToken,{resource:'tariffs',action:'recover',expectedAdminId:peer,tariffId:original.id,id:first.receipt.id}),error=>error.code==='OPERATION_CONFLICT');
  });
  await suite.test('catalog zero/null remain values, not a free-payment implementation; journal is immutable',async()=>{
   const current=await find(),zero=await change(current,{price:'0.00',durationDays:null});assert.equal(zero.tariffs[0].price,'0.00');assert.equal(zero.tariffs[0].durationDays,null);
   await change(zero.tariffs[0],{price:original.price,durationDays:original.durationDays});
   await owner.query('begin');try{await assert.rejects(owner.query('delete from app_admin.tariff_changes'),error=>error.code==='23514');}finally{await owner.query('rollback');}
  });
  await suite.test('actual tariff lock is NOWAIT and leaves no receipt',async()=>{
   const current=await find(),id=randomUUID();await owner.query("begin;select id from app.tariffs where id='listing-publication' for update");
   try{await assert.rejects(change(current,{price:'299.99'},id),error=>error.code==='ACCESS_BUSY');}finally{await owner.query('rollback');}
   assert.equal((await owner.query('select count(*)::int n from app_admin.tariff_changes where id=$1',[id])).rows[0].n,0);
  });
  await suite.test('final clock expiry after audit insert rolls back both row and receipt',async()=>{
   const current=await find(),id=randomUUID(),connection=await operator.connect();let reached=false;
   const notice=event=>{if(event.message==='TARIFF_DELAY_REACHED')reached=true;};connection.on('notice',notice);
   await owner.query("create function app_admin.delay_tariff_test() returns trigger language plpgsql as $$begin raise notice 'TARIFF_DELAY_REACHED';perform pg_sleep(1.2);return new;end$$;create trigger delay_tariff_test before insert on app_admin.tariff_changes for each row execute function app_admin.delay_tariff_test()");
   await owner.query("update app.sessions set expires_at=clock_timestamp()+interval '1 second' where token_hash=$1",[hash(token)]);
   try{await assert.rejects(connection.query('select app_admin.tariff_access($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[hash(token),actor,'change',current.id,id,current.revision,current.name,'299.99',current.durationDays,true,'Проверка истечения']),error=>error.code==='PTA01');assert.equal(reached,true);}
   finally{connection.removeListener('notice',notice);connection.release();await owner.query('drop trigger delay_tariff_test on app_admin.tariff_changes;drop function app_admin.delay_tariff_test()');await owner.query("update app.sessions set expires_at=clock_timestamp()+interval '1 hour' where token_hash=$1",[hash(token)]);}
   assert.equal((await find()).revision,current.revision);assert.equal((await owner.query('select count(*)::int n from app_admin.tariff_changes where id=$1',[id])).rows[0].n,0);
  });
  await suite.test('SQL and TypeScript agree on Cyrillic brackets and Unicode whitespace around HTML-like tags',async()=>{
   let current=await find();const desired={name:'Тариф <скидка>',reason:'Основание <скидка>'};const saved=await change(current,desired);assert.equal(saved.tariffs[0].name,desired.name);current=saved.tariffs[0];
   for(const text of ['<Script>text</Script>','<\u00a0script>x</script>','\u00a0Цена'])await assert.rejects(operator.query('select app_admin.tariff_access($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[hash(token),actor,'change',current.id,randomUUID(),current.revision,text,current.price,current.durationDays,true,'Проверка текста']),error=>error.code==='PTA08');
   await change(current,{name:original.name});
  });
  await suite.test('old financial rows and app schema are not touched by administrative price changes',async()=>{
   const current=await find();await change(current,{price:'397.13',durationDays:41,active:false});
   assert.deepEqual((await owner.query('select to_jsonb(i) intent,to_jsonb(o) purchase from app.payment_checkout_intents i join app.payment_orders o using(id) where i.id=$1',[frozen.id])).rows[0],financialBefore);
   assert.deepEqual(await intents.authorize(frozen),{decision:'recover',providerId});
   const saved=await ownerDb.transaction(tx=>intents.lockKnownInTransaction(tx,frozen.id));assert.equal(saved.requestBody,requestBody);assert.equal(saved.amount,'199.00');assert.equal(saved.durationDays,30);assert.equal(hash(saved.requestBody),financialBefore.intent.request_sha256);
   assert.equal((await owner.query('select count(*)::int n from app.payment_orders')).rows[0].n,1);
   await owner.query('begin read only');assert.deepEqual(await readRefundSchema(owner),before);await owner.query('rollback');
   assert.equal((await owner.query('select count(*)::int n from blizhniy_meta.migrations')).rows[0].n,59);
  });
  await suite.test('hosted tariff authority rejects out-of-scope or unusable terms without writing a receipt',async()=>{
   const migration=await readFile(new URL('../database/candidates/0088-hosted-tariff-policy.sql',import.meta.url),'utf8');
   await owner.query(migration);
   const hostedSignature=signature.replace('.tariff_access(','.hosted_tariff_access(');
   await owner.query('revoke execute on function '+signature+' from blizhniy_user_operator;grant execute on function '+hostedSignature+' to blizhniy_user_operator');
   await assert.rejects(list(),{code:'TARIFF_UNAVAILABLE'});
   const sql='select app_admin.hosted_tariff_access($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as result';
   const call=async(action,target=null,id=null,revision=null,name=null,price=null,days=null,active=null,reason=null)=>
    (await operator.query(sql,[hash(token),actor,action,target,id,revision,name,price,days,active,reason])).rows[0].result;
   const rows=(await call('list')).tariffs;
   const listing=rows.find(row=>row.action==='listing_publication'),response=rows.find(row=>row.action==='job_response'),fair=rows.find(row=>row.action==='fair_participation');
   assert.ok(listing&&response&&fair);
   const changeHosted=(row,id,price,days,active,name=row.name)=>call('change',row.id,id,row.revision,name,price,days,active,'Проверка условий тарифа');
   for(const [row,price,days,active,name] of [
    [listing,'0.00',30,true], [listing,'199.00',null,true], [response,'199.00',30,true],
    [fair,'199.00',null,true], [listing,'199.00',30,true,'Другое название'],
   ]){
    const id=randomUUID();
    await assert.rejects(changeHosted(row,id,price,days,active,name),{code:'PTA09'});
    assert.equal((await call('recover',row.id,id)).receipt,null);
   }
   assert.deepEqual((await call('list')).tariffs,rows);
   const id=randomUUID(),changed=await changeHosted(listing,id,'249.51',31,true);
   assert.deepEqual([changed.receipt.next.price,changed.receipt.next.durationDays,changed.receipt.next.active],['249.51',31,true]);
   assert.deepEqual((await call('recover',listing.id,id)).receipt,changed.receipt);
   assert.deepEqual((await changeHosted(listing,id,'249.51',31,true)).receipt,changed.receipt);
   await owner.query('begin read only');assert.deepEqual(await readRefundSchema(owner),before);await owner.query('rollback');
  });
 }finally{await ownerDb?.close();await operator?.end();await owner?.end();if(container){const m=JSON.parse(await docker(['inspect',container]))[0];assert.equal(m.Config.Labels[label],name);await docker(['rm','--force',container]);}}
});
