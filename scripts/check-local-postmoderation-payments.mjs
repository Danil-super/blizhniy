// Opt-in owned local PostgreSQL check. Entire financial fixtures roll back; no provider network.
import assert from 'node:assert/strict';
import {randomUUID,randomInt,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import pg from 'pg';
import {stateFile,localPrimaryDatabaseConfig,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
import {localPrimaryPaymentHandler} from './local-primary-payment.mjs';
const load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const owner=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));await owner.connect();
const oldEnv=Object.fromEntries(['NODE_ENV','BLIZHNIY_LISTING_WORKFLOW','BLIZHNIY_LOCAL_PRIMARY','BLIZHNIY_LOCAL_PRIMARY_ORIGIN'].map(key=>[key,process.env[key]]));
Object.assign(process.env,{NODE_ENV:'test',BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:state.origin});
let checks=0;
const origin='https://xn----9sbphbgks4a4a.xn--p1ai';
const request=(path,token,body,method='POST',form=false)=>new Request(origin+path,{method,headers:{host:new URL(origin).host,origin,'sec-fetch-site':'same-origin','content-type':form?'application/x-www-form-urlencoded':'application/json','x-blizhniy-request':'1','x-real-ip':'127.0.0.1',cookie:'__Host-blizhniy_session='+token},...(method==='GET'?{}:{body:form?new URLSearchParams(body):JSON.stringify(body)})});
try{
 await owner.query('begin');
 const tx={query:(sql,values)=>owner.query(sql,values)},database={...tx,transaction:work=>work(tx)},context={state,ownerDb:database,runtimeDb:database,load};
 const user=(await owner.query('insert into app.users(email,password_hash,email_verified_at,role) values($1,$2,clock_timestamp(),$3) returning id',[`pay-local-${randomUUID()}@example.invalid`,`scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`,'admin'])).rows[0].id;
 const token=randomBytes(32).toString('hex');await owner.query("insert into app.sessions(token_hash,user_id,auth_version,scope) values($1,$2,0,'app')",[load('identity').hashSessionToken(token),user]);
 const phone='+7999'+String(randomInt(10_000_000)).padStart(7,'0');
 await owner.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)',[user,JSON.stringify({name:'Синтетический автор',phone})]);
 await owner.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[user,phone,'synthetic-listing-payment-'+randomUUID()]);
 assert.equal((await owner.query('select app.phone_is_confirmed($1) as confirmed',[user])).rows[0].confirmed,true);
 async function fixture(){
  const id=(await owner.query("insert into app.listings(author_id,listing_type,category_id,city_id,title,description,contact_phone) select $1,'sell',c.id,city.id,'Проверка локальной оплаты','Синтетическое объявление для проверки платежей.','+79990000000' from app.categories c cross join app.cities city where c.slug='otdyh' and city.name='Краснодар' returning id",[user])).rows[0].id;
  const preview=await localPrimaryPaymentHandler(request('/api/account/listing-checkout',token,{action:'testPreview',expectedOwnerId:user,listingId:id,expectedRevision:'1'}),context);
  assert.equal(preview.status,200);const quote=await preview.json();
  const prepare=await localPrimaryPaymentHandler(request('/api/account/listing-checkout',token,{expectedOwnerId:user,creationKey:randomUUID(),listingId:id,expectedRevision:'1',expectedTariffId:quote.tariff.id,expectedAmount:quote.tariff.amount,expectedDurationDays:quote.tariff.durationDays},'PUT'),context);
  assert.equal(prepare.status,200);const order=await prepare.json();
  const dispatch=await localPrimaryPaymentHandler(request('/api/account/listing-checkout',token,{action:'dispatch',expectedOwnerId:user,paymentId:order.id}),context);
  assert.equal(dispatch.status,200);assert.equal((await dispatch.json()).isTest,true);
  return{id,order};
 }
 const record=async id=>(await owner.query('select status,is_paid,published_at::text,expires_at::text from app.listings where id=$1',[id])).rows[0];
 const count=async id=>(await owner.query('select count(*)::int as n from app.payment_fulfillments where intent_id=$1',[id])).rows[0].n;
 async function check(name,work){await work();checks++;console.log(JSON.stringify({check:name,status:'passed'}));}
 await check('no preapproval required, pending and canceled outcomes never publish',async()=>{
  const pending=await fixture();assert.equal((await owner.query('select count(*)::int as n from app.listing_moderation where listing_id=$1',[pending.id])).rows[0].n,0);
  let result=await localPrimaryPaymentHandler(request('/__local/payment?intent='+pending.order.id,token,{action:'pending'},'POST',true),context);assert.equal(result.status,200);assert.equal((await record(pending.id)).is_paid,false);assert.equal(await count(pending.order.id),0);
  result=await localPrimaryPaymentHandler(request('/__local/payment?intent='+pending.order.id,token,{action:'cancel'},'POST',true),context);assert.equal(result.status,200);assert.equal((await record(pending.id)).status,'draft');assert.equal(await count(pending.order.id),0);
  result=await localPrimaryPaymentHandler(request('/__local/payment?intent='+pending.order.id,token,{action:'succeed'},'POST',true),context);assert.equal(result.status,200);assert.equal((await record(pending.id)).is_paid,false);assert.equal(await count(pending.order.id),0);
 });
 await check('captured simulator result publishes exactly once; replay never extends expiry',async()=>{
  const item=await fixture();const first=await localPrimaryPaymentHandler(request('/__local/payment?intent='+item.order.id,token,{action:'succeed'},'POST',true),context);assert.equal(first.status,200);
  const before=await record(item.id);assert.equal(before.status,'published');assert.equal(before.is_paid,true);assert.equal(await count(item.order.id),1);
  const replay=await localPrimaryPaymentHandler(request('/__local/payment?intent='+item.order.id,token,{action:'succeed'},'POST',true),context);assert.equal(replay.status,200);assert.deepEqual(await record(item.id),before);assert.equal(await count(item.order.id),1);
  const publicStore=new(load('postgres-public-listings').PostgresPublicListingStore)(tx,{postmoderation:true});assert.equal((await publicStore.read(item.id)).id,item.id);
  await new(load('postgres-listing-management').PostgresListingManagementStore)(database).block(token,user,item.id,'1','Нарушение правил');
  assert.equal(await publicStore.read(item.id),undefined);
  const again=await localPrimaryPaymentHandler(request('/__local/payment?intent='+item.order.id,token,{action:'succeed'},'POST',true),context);assert.equal(again.status,200);assert.equal(await publicStore.read(item.id),undefined);assert.deepEqual(await record(item.id),before);
 });
 await check('blocking before captured result prevents publication without changing financial truth',async()=>{
  const item=await fixture();await new(load('postgres-listing-management').PostgresListingManagementStore)(database).block(token,user,item.id,'1','Нарушение правил');
  const result=await localPrimaryPaymentHandler(request('/__local/payment?intent='+item.order.id,token,{action:'succeed'},'POST',true),context);assert.equal(result.status,200);assert.equal((await record(item.id)).is_paid,false);assert.equal(await count(item.order.id),0);
  const preview=await localPrimaryPaymentHandler(request('/api/account/listing-checkout',token,{action:'testPreview',expectedOwnerId:user,listingId:item.id,expectedRevision:'1'}),context);assert.equal(preview.status,409);
 });
 console.log(JSON.stringify({status:'passed',checks,providerNetwork:false,realCharges:false,productionTouched:false,fixtures:'rolled-back'}));
}finally{
 try{await owner.query('rollback');}finally{await owner.end();for(const [key,value] of Object.entries(oldEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}
