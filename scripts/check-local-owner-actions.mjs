// Own loopback container only; tests roll back. Schema/grant commit only after all checks pass.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import pg from 'pg';
import {stateFile,localPrimaryDatabaseConfig,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
import {getBootstrapPlan} from './postgres-migration-plan.mjs';
import {localPrimaryPaymentHandler} from './local-primary-payment.mjs';
const load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const connection=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));await connection.connect();
Object.assign(process.env,{NODE_ENV:'test',BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:state.origin});
const extras=[];
for(const name of ['0026-listing-blocks.sql','0027-listing-owner-visibility.sql','0028-listing-restore-entitlement.sql']){
 const source=await readFile(new URL('../database/migrations/'+name,import.meta.url),'utf8');extras.push({name,source,sha256:createHash('sha256').update(source).digest('hex')});
}
const prefix=[...getBootstrapPlan({includeListingContactMethod:true}).map(({name,sha256})=>({name,sha256})),{name:extras[0].name,sha256:extras[0].sha256}];
const journal=(await connection.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
assert.ok(journal.length>=26&&journal.length<=28);
assert.deepEqual(journal,[...prefix,...extras.slice(1,journal.length-25).map(({name,sha256})=>({name,sha256}))]);
const tx={query:(sql,values)=>connection.query(sql,values)},db={...tx,transaction:work=>work(tx)},context={state,ownerDb:db,runtimeDb:db,load};
const canonical='https://xn----9sbphbgks4a4a.xn--p1ai';
let checks=0;
async function check(name,work){await work();checks++;console.log(JSON.stringify({check:name,status:'passed'}));}
try{
 await connection.query('begin');
 for(const migration of extras.slice(journal.length-25)){await connection.query(migration.source.replace(/^begin;\r?\n/m,'').replace(/commit;\s*$/,''));await connection.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[migration.name,migration.sha256]);}
 await connection.query('grant update(status) on app.listings to blizhniy_runtime');
 await connection.query('savepoint fixtures');
 const user=(await connection.query("insert into app.users(email,password_hash,email_verified_at,role) values($1,$2,clock_timestamp(),'admin') returning id",[`owner-actions-${randomUUID()}@local.invalid`,`scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`])).rows[0].id;
 const token=randomBytes(32).toString('hex');await connection.query("insert into app.sessions(token_hash,user_id,auth_version,scope) values($1,$2,0,'app')",[load('identity').hashSessionToken(token),user]);
 const id=(await connection.query("insert into app.listings(author_id,listing_type,category_id,city_id,title,description,contact_phone) select $1,'sell',c.id,city.id,'Проверка действий владельца','Только локальные синтетические данные.','+79990000000' from app.categories c cross join app.cities city where c.slug='otdyh' and city.name='Краснодар' returning id",[user])).rows[0].id;
 const request=(path,body,method='POST',form=false)=>new Request(canonical+path,{method,headers:{host:new URL(canonical).host,origin:canonical,'sec-fetch-site':'same-origin','content-type':form?'application/x-www-form-urlencoded':'application/json','x-blizhniy-request':'1','x-real-ip':'127.0.0.1',cookie:'__Host-blizhniy_session='+token},body:form?new URLSearchParams(body):JSON.stringify(body)});
 const preview=await localPrimaryPaymentHandler(request('/api/account/listing-checkout',{action:'testPreview',expectedOwnerId:user,listingId:id,expectedRevision:'1'}),context);assert.equal(preview.status,200);const quote=await preview.json();
 const prepare=await localPrimaryPaymentHandler(request('/api/account/listing-checkout',{expectedOwnerId:user,creationKey:randomUUID(),listingId:id,expectedRevision:'1',expectedTariffId:quote.tariff.id,expectedAmount:quote.tariff.amount,expectedDurationDays:quote.tariff.durationDays},'PUT'),context);assert.equal(prepare.status,200);const order=await prepare.json();
 assert.equal((await localPrimaryPaymentHandler(request('/api/account/listing-checkout',{action:'dispatch',expectedOwnerId:user,paymentId:order.id}),context)).status,200);
 assert.equal((await localPrimaryPaymentHandler(request('/__local/payment?intent='+order.id,{action:'succeed'},'POST',true),context)).status,200);
 const record=async()=> (await connection.query('select is_paid,published_at::text,expires_at::text from app.listings where id=$1',[id])).rows[0],before=await record();
 const actions=new(load('postgres-listing-owner-actions').PostgresListingOwnerActions)(db),forms=new(load('postgres-listing-form').PostgresListingFormStore)(db,{contactMethod:true,postmoderation:true});
 const publicStore=new(load('postgres-public-listings').PostgresPublicListingStore)(tx,{postmoderation:true});
 await connection.query('set local role blizhniy_runtime');
 await check('published full-form editing preserves paid period and rejects incomplete publication',async()=>{
  const snapshot=await forms.read(token,user,id);assert.equal(snapshot.revision,'1');
  const edited=await forms.update(token,user,id,'1',{...snapshot.form,title:'Исправленное объявление'});assert.equal(edited.revision,'2');assert.equal((await publicStore.read(id)).title,'Исправленное объявление');assert.deepEqual(await record(),before);
  await assert.rejects(forms.update(token,user,id,'2',{...edited.form,title:''}));
  await connection.query('savepoint inactive_category');
  await connection.query('reset role');await connection.query('update app.categories set active=false where id=(select category_id from app.listings where id=$1)',[id]);await connection.query('set local role blizhniy_runtime');
  await assert.rejects(forms.update(token,user,id,'2',edited.form),{name:'ListingDraftInputError'});
  await connection.query('rollback to savepoint inactive_category');
 });
 await check('withdraw, restore, foreign owner and stale CAS preserve financial truth',async()=>{
  await assert.rejects(actions.change(token,randomUUID(),id,'2','withdraw'));
  await assert.rejects(actions.change(token,user,id,'1','withdraw'));
  assert.equal((await actions.change(token,user,id,'2','withdraw')).status,'archived');assert.equal(await publicStore.read(id),undefined);assert.deepEqual(await record(),before);
  assert.equal((await actions.change(token,user,id,'3','restore')).status,'published');assert.equal((await publicStore.read(id)).id,id);assert.deepEqual(await record(),before);
 });
 await check('refunded receipt cannot restore; runtime cannot fabricate payment, expiry or bypass a block',async()=>{
  for(const sql of ["update app.listings set status='draft',revision=revision+1 where id=$1","update app.listings set expires_at=expires_at+interval '1 day' where id=$1","update app.listings set is_paid=false where id=$1"]){
   await connection.query('savepoint denial');await assert.rejects(connection.query(sql,[id]),{code:'42501'});await connection.query('rollback to savepoint denial');
  }
  await actions.change(token,user,id,'4','withdraw');
  await connection.query('reset role');await connection.query("update app.payment_orders set status='refunded' where id=$1",[order.id]);await connection.query('set local role blizhniy_runtime');
  await assert.rejects(actions.change(token,user,id,'5','restore'));
  await connection.query('savepoint refunded_denial');await assert.rejects(connection.query("update app.listings set status='published',revision=revision+1 where id=$1",[id]),{code:'42501'});await connection.query('rollback to savepoint refunded_denial');
  await new(load('postgres-listing-management').PostgresListingManagementStore)(db).block(token,user,id,'5','Локальная проверка запрета повторной публикации');
  await assert.rejects(actions.change(token,user,id,'5','withdraw'));assert.equal(await publicStore.read(id),undefined);assert.deepEqual(await record(),before);
 });
 await connection.query('reset role');await connection.query('rollback to savepoint fixtures');
 await connection.query('commit');
 console.log(JSON.stringify({status:'passed',checks,schema:28,grant:'UPDATE(status), guarded',fixtures:'rolled-back',productionTouched:false}));
}catch(error){await connection.query('rollback');throw error;}finally{await connection.end();}
