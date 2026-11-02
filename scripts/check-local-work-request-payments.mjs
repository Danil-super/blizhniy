// Synthetic fixtures only, in the validated owned PostgreSQL18 stand. Always ROLLBACK.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import pg from 'pg';
import {stateFile,localPrimaryDatabaseConfig,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
import {localPrimaryPaymentHandler} from './local-primary-payment.mjs';
const load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const owner=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));await owner.connect();
const keys=['NODE_ENV','BLIZHNIY_LISTING_WORKFLOW','BLIZHNIY_LOCAL_PRIMARY','BLIZHNIY_LOCAL_PRIMARY_ORIGIN'];
const oldEnv=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
Object.assign(process.env,{NODE_ENV:'test',BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:state.origin});
const origin='https://xn----9sbphbgks4a4a.xn--p1ai';
const endpoint='/api/account/work-request-checkout';
const request=(path,token,body,method='POST',form=false)=>new Request(origin+path,{method,headers:{host:new URL(origin).host,origin,'sec-fetch-site':'same-origin','content-type':form?'application/x-www-form-urlencoded':'application/json','x-blizhniy-request':'1','x-real-ip':'192.0.2.122',cookie:'__Host-blizhniy_session='+token},...(method==='GET'?{}:{body:form?new URLSearchParams(body):JSON.stringify(body)})});
let n=0,checks=0;
try{
 await owner.query('begin');const tx={query:(sql,values)=>owner.query(sql,values)};
 const db=role=>({...tx,transaction:async work=>{const key=`local_work_request_${++n}`;await owner.query(`savepoint ${key}`);
  try{if(role)await owner.query('set local role blizhniy_runtime');const result=await work(tx);if(role)await owner.query('reset role');await owner.query(`release savepoint ${key}`);return result;}
  catch(error){await owner.query(`rollback to savepoint ${key}`);await owner.query('reset role');await owner.query(`release savepoint ${key}`);throw error;}}});
 const runtime=db(true),trusted=db(false),context={state,ownerDb:trusted,runtimeDb:runtime,load};
 const forms=new(load('postgres-work-publications').PostgresWorkPublicationStore)(runtime);
 async function account(){const user=(await owner.query('insert into app.users(email,password_hash,email_verified_at) values($1,$2,clock_timestamp()) returning id',[
  `work-request-pay-${randomUUID()}@example.invalid`,`scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`])).rows[0].id;
  const token=randomBytes(32).toString('hex');await owner.query("insert into app.sessions(token_hash,user_id,auth_version,scope) values($1,$2,0,'app')",[load('identity').hashSessionToken(token),user]);
  const phone='+7999'+String(randomBytes(4).readUInt32BE()%10000000).padStart(7,'0');
  await owner.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)',[user,JSON.stringify({name:'Синтетический заказчик',phone})]);
  await owner.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[user,phone,'synthetic-order-payment-'+randomUUID()]);
  assert.equal((await owner.query('select app.phone_is_confirmed($1) as confirmed',[user])).rows[0].confirmed,true);
  return{user,token};}
 const {user,token}=await account(),foreign=await account();
 const base={kind:'workRequest',title:'Локальный заказ сантехнику',description:'Синтетический заказ для проверки размещения и оплаты.',cityName:'Краснодар',professionName:'Сантехник',contactPhone:'+79990000000',placementRightConfirmed:true,
  budget:'7400.00',district:'Центральный',address:'Синтетический адрес, 1',latitude:45.0355,longitude:38.9753,showExactAddress:false,messengerUrl:'https://t.me/synthetic_fixture'};
 const call=(body,method='POST',path=endpoint,actor={user,token})=>localPrimaryPaymentHandler(request(path,actor.token,{expectedOwnerId:actor.user,...body},method),context);
 async function create(patch={}){return forms.create(token,user,'workRequest',randomUUID(),{...base,...patch});}
 async function quote(item){const response=await call({action:'testPreview',listingId:item.id,expectedRevision:item.revision});assert.ok(response,'The work-request checkout endpoint must be handled');assert.equal(response.status,200);return response.json();}
 async function prepare(item,key=randomUUID()){
  const q=await quote(item),body={creationKey:key,listingId:item.id,expectedRevision:item.revision,expectedTariffId:q.tariff.id,expectedAmount:q.tariff.amount,expectedDurationDays:q.tariff.durationDays};
  const response=await call(body,'PUT');assert.equal(response.status,200);return{order:await response.json(),body};
 }
 async function fixture(patch={}){const item=await create(patch),saved=await prepare(item);const response=await call({action:'dispatch',paymentId:saved.order.id});assert.equal(response.status,200);return{item,...saved};}
 const pay=(order,action='succeed',actorToken=token,type='workRequest')=>localPrimaryPaymentHandler(request(`/__local/payment?intent=${order.id}&type=${type}`,actorToken,{action},'POST',true),context);
 const row=async id=>(await owner.query('select status,is_paid,published_at::text,expires_at::text from app.work_publications where id=$1',[id])).rows[0];
 const count=async id=>(await owner.query('select count(*)::int as n from app.payment_fulfillments where intent_id=$1',[id])).rows[0].n;
 const publicRead=id=>runtime.transaction(tx=>new(load('postgres-public-work').PostgresPublicWorkStore)(tx,{vacancyPostmoderation:true}).read('workRequest',id));
 async function check(name,work){await work();checks++;console.log(JSON.stringify({check:name,status:'passed'}));}
 await check('complete private draft round-trips all saved order fields; runtime cannot manufacture publication or payment',async()=>{
  const item=await create(),saved=await forms.read(token,user,'workRequest',item.id);assert.deepEqual(saved.form,item.form);assert.equal((await quote(item)).tariff.id,'work-request-publication');
  for(const column of ['is_paid=true',"status='published'",'expires_at=clock_timestamp()'])await assert.rejects(runtime.transaction(tx=>tx.query(`update app.work_publications set ${column} where id=$1`,[item.id])),error=>error.code==='42501');
 });
 await check('incomplete and invalid fields remain editable drafts but cannot enter checkout',async()=>{
  for(const patch of [{title:'ab'},{description:''},{professionName:null},{cityName:null},{contactPhone:'123',messengerUrl:null},{placementRightConfirmed:false}]){
   if(patch.contactPhone==='123'){
    const before=(await owner.query('select count(*)::int as n from app.work_publications where author_id=$1',[user])).rows[0].n;
    await assert.rejects(create(patch),load('work-publication-contract').WorkPublicationInputError);
    assert.equal((await owner.query('select count(*)::int as n from app.work_publications where author_id=$1',[user])).rows[0].n,before);
    continue;
   }
   const item=await create(patch),response=await call({action:'testPreview',listingId:item.id,expectedRevision:item.revision});assert.equal(response.status,409);assert.equal((await row(item.id)).is_paid,false);
  }
 });
 await check('prepare replay keeps one immutable request, correct target action and return path; mismatched offer cannot prepare',async()=>{
  const item=await create(),saved=await prepare(item),again=await call(saved.body,'PUT');assert.equal(again.status,200);assert.equal((await again.json()).id,saved.order.id);
  const receipt=(await owner.query('select target_type,tariff_id,request_body from app.payment_checkout_intents where id=$1',[saved.order.id])).rows[0];
  const body=JSON.parse(receipt.request_body);assert.equal(receipt.target_type,'workRequest');assert.equal(receipt.tariff_id,'work-request-publication');assert.equal(body.metadata.targetType,'workRequest');assert.match(body.confirmation.return_url,/\/oplata\/[a-f0-9-]{36}\?type=workRequest$/);
  const tariff=(await owner.query('select action from app.tariffs where id=$1',[receipt.tariff_id])).rows[0];assert.equal(tariff.action,'work_request_publication');
  for(const patch of [{expectedAmount:'1.00'},{expectedDurationDays:1},{expectedTariffId:'vacancy-publication'}]){
   const other=await create(),q=await quote(other);const response=await call({...saved.body,creationKey:randomUUID(),listingId:other.id,expectedRevision:other.revision,expectedAmount:q.tariff.amount,expectedDurationDays:q.tariff.durationDays,...patch},'PUT');assert.equal(response.status,409);
  }
  const intentCount=(await owner.query('select count(*)::int n from app.payment_checkout_intents where target_id=$1',[item.id])).rows[0].n;assert.equal(intentCount,1);
 });
 await check('foreign owner and wrong-kind endpoints cannot read, dispatch, or settle the saved work-request purchase',async()=>{
  const f=await fixture();assert.equal((await call({action:'order',paymentId:f.order.id},'POST',endpoint,foreign)).status,200);
  assert.equal(await(await call({action:'order',paymentId:f.order.id},'POST',endpoint,foreign)).json(),null);
  assert.notEqual((await call({action:'dispatch',paymentId:f.order.id},'POST',endpoint,foreign)).status,200);
  assert.equal((await pay(f.order,'succeed',foreign.token)).status,404);
  for(const path of ['/api/account/listing-checkout','/api/account/vacancy-checkout']){
   const read=await call({action:'order',paymentId:f.order.id},'POST',path);assert.equal(read.status,200);assert.equal(await read.json(),null);
   assert.notEqual((await call({action:'dispatch',paymentId:f.order.id},'POST',path)).status,200);
   assert.notEqual((await call({action:'intent',creationKey:f.body.creationKey},'POST',path)).status,200);
  }
  assert.equal((await pay(f.order,'succeed',token,'vacancy')).status,404);assert.equal((await row(f.item.id)).is_paid,false);assert.equal(await count(f.order.id),0);
  const vacancy=await forms.create(token,user,'vacancy',randomUUID(),{kind:'vacancy',title:'Не заказ',description:'Синтетическая вакансия'});
  assert.notEqual((await call({action:'testPreview',listingId:vacancy.id,expectedRevision:vacancy.revision})).status,200);
 });
 await check('pending or canceled capture never publishes and canceled purchase cannot later become paid',async()=>{
  const f=await fixture();for(const action of ['pending','cancel','succeed']){
   assert.equal((await pay(f.order,action)).status,200);assert.equal((await row(f.item.id)).status,'draft');assert.equal(await count(f.order.id),0);assert.equal(await publicRead(f.item.id),undefined);
  }
 });
 await check('verified capture publishes once with no premoderation; public DTO keeps contacts private; refund and replay do not resurrect',async()=>{
  const f=await fixture();assert.equal(await publicRead(f.item.id),undefined);assert.equal((await pay(f.order)).status,200);
  const before=await row(f.item.id);assert.equal(before.status,'published');assert.equal(before.is_paid,true);assert.equal(await count(f.order.id),1);
  assert.equal((await owner.query('select count(*)::int n from app.work_moderation where publication_id=$1',[f.item.id])).rows[0].n,0);
  const visible=await publicRead(f.item.id);assert.equal(visible.id,f.item.id);assert.equal(visible.budget,'7 400 ₽');
  const defaultRead=await runtime.transaction(tx=>new(load('postgres-public-work').PostgresPublicWorkStore)(tx).read('workRequest',f.item.id));assert.equal(defaultRead,undefined,'Default production policy must not expose a local-only postmoderation payment');
  for(const key of ['phone','contactPhone','messengerUrl','address','latitude','longitude','lat','lng','email','inn'])assert.ok(visible[key]===undefined||visible[key]===null,`Private ${key} must be absent from public output`);
  assert.equal((await pay(f.order)).status,200);assert.deepEqual(await row(f.item.id),before);assert.equal(await count(f.order.id),1);
  const list=await runtime.transaction(tx=>new(load('postgres-public-work').PostgresPublicWorkStore)(tx,{vacancyPostmoderation:true}).list('workRequest'));assert.ok(list.some(item=>item.id===f.item.id));
  await owner.query("update app.payment_orders set status='refunded' where id=$1",[f.order.id]);assert.equal(await publicRead(f.item.id),undefined);
  assert.equal((await pay(f.order)).status,200);assert.equal(await publicRead(f.item.id),undefined);assert.deepEqual(await row(f.item.id),before);assert.equal(await count(f.order.id),1);
 });
 await check('profession rename preserves identity; city rename and disabled profession prevent publication after capture',async()=>{
  for(const mode of ['city','profession','disable']){
   const f=await fixture();await owner.query('savepoint work_reference_change');
   if(mode==='city')await owner.query("update app.cities set name=name||' (новое)' where name=$1",[base.cityName]);
   else if(mode==='profession')await owner.query("update app.specialist_categories set name=name||' (новое)' where name=$1",[base.professionName]);
   else await owner.query('update app.specialist_categories set active=false where name=$1',[base.professionName]);
   const quoted=await call({action:'testPreview',listingId:f.item.id,expectedRevision:f.item.revision});
   if(mode==='profession'){
    assert.equal(quoted.status,200);assert.equal((await pay(f.order)).status,200);
    const placed=await row(f.item.id);assert.equal(placed.is_paid,true);assert.equal(placed.status,'published');assert.equal(await count(f.order.id),1);
    assert.equal((await publicRead(f.item.id)).profession,base.professionName+' (новое)');
    assert.equal((await pay(f.order)).status,200);assert.deepEqual(await row(f.item.id),placed);assert.equal(await count(f.order.id),1);
   }else{
    assert.equal(quoted.status,409);
    assert.equal((await pay(f.order)).status,200);assert.equal((await row(f.item.id)).is_paid,false);assert.equal(await count(f.order.id),0);
   }
   await owner.query('rollback to savepoint work_reference_change');await owner.query('release savepoint work_reference_change');
  }
 });
 await check('edited or deleted order cannot publish stale purchased revision while verified financial result remains recorded',async()=>{
  for(const mode of ['edit','delete']){
   const f=await fixture();
   if(mode==='edit')await forms.update(token,user,'workRequest',f.item.id,f.item.revision,{...f.item.form,title:'Изменённый заказ'});
   else await owner.query('update app.work_publications set deleted_at=clock_timestamp() where id=$1',[f.item.id]);
   const response=await pay(f.order);assert.equal(response.status,200);assert.match(await response.text(),/target_changed/);
   assert.equal((await row(f.item.id)).is_paid,false);assert.equal(await count(f.order.id),0);assert.equal(await publicRead(f.item.id),undefined);
   assert.equal((await owner.query('select status from app.payment_orders where id=$1',[f.order.id])).rows[0].status,'succeeded');
  }
 });
 await check('tariff change before first dispatch fails without provider link or publication',async()=>{
  const item=await create(),f=await prepare(item);await owner.query('savepoint work_tariff_change');
  await owner.query("update app.tariffs set price=price+1 where id='work-request-publication'");
  assert.equal((await call({action:'dispatch',paymentId:f.order.id})).status,409);
  assert.equal((await owner.query('select count(*)::int n from app.payment_provider_links where intent_id=$1',[f.order.id])).rows[0].n,0);assert.equal((await row(item.id)).is_paid,false);
  await owner.query('rollback to savepoint work_tariff_change');await owner.query('release savepoint work_tariff_change');
 });
 await check('blocked or newly unverified account cannot publish even after the provider confirms capture',async()=>{
  for(const mode of ['blocked','unverified']){
   const f=await fixture();await owner.query('savepoint work_account_change');
   await owner.query(mode==='blocked'?'update app.users set is_blocked=true where id=$1':'update app.users set email_verified_at=null where id=$1',[user]);
   const merchant={shopId:'local-fixture-shop',isTest:true};
   await owner.query("update app.payment_orders set status='succeeded' where id=$1",[f.order.id]);
   const linked=(await owner.query('select provider_payment_id from app.payment_provider_links where intent_id=$1',[f.order.id])).rows[0];
   await owner.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'))",[f.order.id,linked.provider_payment_id]);
   const result=await new(load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(trusted,merchant,{targetType:'workRequest'}).fulfill(f.order.id);
   assert.equal(result.state,'blocked');assert.equal(result.reason,'account_unavailable');assert.equal((await row(f.item.id)).is_paid,false);assert.equal(await count(f.order.id),0);assert.equal(await publicRead(f.item.id),undefined);
   await owner.query('rollback to savepoint work_account_change');await owner.query('release savepoint work_account_change');
  }
 });
 await check('tariff changes after provider dispatch preserve the original receipt, amount and purchased duration',async()=>{
  const f=await fixture(),before=(await owner.query('select amount::text,duration_days,request_body from app.payment_checkout_intents where id=$1',[f.order.id])).rows[0];
  await owner.query('savepoint work_original_terms');await owner.query("update app.tariffs set price=price+10,duration_days=duration_days+1 where id='work-request-publication'");
  assert.equal((await pay(f.order)).status,200);assert.equal((await row(f.item.id)).is_paid,true);
  assert.deepEqual((await owner.query('select amount::text,duration_days,request_body from app.payment_checkout_intents where id=$1',[f.order.id])).rows[0],before);
  const duration=(await owner.query('select extract(epoch from(expires_at-published_at))/86400 as days from app.payment_fulfillments where intent_id=$1',[f.order.id])).rows[0];assert.equal(Number(duration.days),before.duration_days);
  await owner.query('rollback to savepoint work_original_terms');await owner.query('release savepoint work_original_terms');
 });
 await check('editing a paid published order preserves its purchased term and public visibility without requiring a second payment',async()=>{
  const f=await fixture();assert.equal((await pay(f.order)).status,200);const before=await row(f.item.id);
  const receiptBefore=(await owner.query('select request_body,amount::text,duration_days,target_revision::text from app.payment_checkout_intents where id=$1',[f.order.id])).rows[0];
  const saved=await forms.update(token,user,'workRequest',f.item.id,f.item.revision,{...f.item.form,title:'Исправленный оплаченный заказ'});
  assert.notEqual(saved.revision,f.item.revision);assert.deepEqual(await row(f.item.id),before);
  const visible=await publicRead(f.item.id);assert.ok(visible,'Editing must not silently hide a paid publication while payment stays locked');assert.equal(visible.title,'Исправленный оплаченный заказ');
  assert.equal(await count(f.order.id),1);assert.equal((await owner.query('select count(*)::int n from app.payment_orders where target_id=$1',[f.item.id])).rows[0].n,1);
  assert.equal((await pay(f.order)).status,200);assert.deepEqual(await row(f.item.id),before);assert.equal((await publicRead(f.item.id)).title,saved.form.title);assert.equal(await count(f.order.id),1);
  assert.deepEqual((await owner.query('select request_body,amount::text,duration_days,target_revision::text from app.payment_checkout_intents where id=$1',[f.order.id])).rows[0],receiptBefore);
  await owner.query("update app.payment_orders set status='refunded' where id=$1",[f.order.id]);assert.equal(await publicRead(f.item.id),undefined);
  assert.equal((await pay(f.order)).status,200);assert.equal(await publicRead(f.item.id),undefined);assert.deepEqual(await row(f.item.id),before);assert.equal(await count(f.order.id),1);
 });
 await check('invalid edits to a paid publication are rejected atomically instead of losing its public visibility',async()=>{
  const f=await fixture();assert.equal((await pay(f.order)).status,200);const before=await forms.read(token,user,'workRequest',f.item.id);
  const InputError=load('work-publication-contract').WorkPublicationInputError;
  for(const patch of [{title:''},{description:''},{professionName:null},{budget:'0.00'},{messengerUrl:'javascript:alert(1)'},{cityName:null}]){
   await assert.rejects(forms.update(token,user,'workRequest',f.item.id,f.item.revision,{...f.item.form,...patch}),error=>error instanceof InputError);
   assert.deepEqual(await forms.read(token,user,'workRequest',f.item.id),before);assert.equal((await publicRead(f.item.id)).id,f.item.id);assert.equal(await count(f.order.id),1);
  }
 });
 console.log(JSON.stringify({status:'passed',checks,runtimeRole:'blizhniy_runtime',realCharges:false,productionTouched:false,fixtures:'rolled-back'}));
}finally{try{await owner.query('rollback');}finally{await owner.end();for(const key of keys){if(oldEnv[key]===undefined)delete process.env[key];else process.env[key]=oldEnv[key];}}}
