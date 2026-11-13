// Only the explicitly owned synthetic PostgreSQL18 stand. All fixtures roll back.
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
const request=(path,token,body,method='POST',form=false)=>new Request(origin+path,{method,headers:{host:new URL(origin).host,origin,'sec-fetch-site':'same-origin','content-type':form?'application/x-www-form-urlencoded':'application/json','x-blizhniy-request':'1','x-real-ip':'192.0.2.121',cookie:'__Host-blizhniy_session='+token},...(method==='GET'?{}:{body:form?new URLSearchParams(body):JSON.stringify(body)})});
let n=0,checks=0;
try{
 await owner.query('begin');const tx={query:(sql,values)=>owner.query(sql,values)};
 const db=role=>({...tx,transaction:async work=>{const key=`local_vacancy_${++n}`;await owner.query(`savepoint ${key}`);
  try{if(role)await owner.query('set local role blizhniy_runtime');const result=await work(tx);if(role)await owner.query('reset role');await owner.query(`release savepoint ${key}`);return result;}
  catch(error){await owner.query(`rollback to savepoint ${key}`);await owner.query('reset role');await owner.query(`release savepoint ${key}`);throw error;}}});
 const runtime=db(true),trusted=db(false),context={state,ownerDb:trusted,runtimeDb:runtime,load};
 const forms=new(load('postgres-work-publications').PostgresWorkPublicationStore)(runtime);
 const user=(await owner.query('insert into app.users(email,password_hash,email_verified_at) values($1,$2,clock_timestamp()) returning id',[
  `vacancy-pay-${randomUUID()}@example.invalid`,`scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`])).rows[0].id;
 const token=randomBytes(32).toString('hex');await owner.query("insert into app.sessions(token_hash,user_id,auth_version,scope) values($1,$2,0,'app')",[load('identity').hashSessionToken(token),user]);
 const phone='+7999'+String(randomBytes(4).readUInt32BE()%10000000).padStart(7,'0');
 await owner.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)',[user,JSON.stringify({name:'Синтетический работодатель',phone})]);
 await owner.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[user,phone,'synthetic-vacancy-payment-'+randomUUID()]);
 assert.equal((await owner.query('select app.phone_is_confirmed($1) as confirmed',[user])).rows[0].confirmed,true);

 const base={kind:'vacancy',title:'Локальная проверка вакансии',description:'Синтетическая вакансия для проверки оплаты.',cityName:'Краснодар',professionName:'Сантехник',contactPhone:'+79990000000',placementRightConfirmed:true,
  employerType:'organization',organization:'Мастерская',inn:'7707083893',ogrn:'1027700132195',contactPerson:'Иван Иванов',email:'hr@example.invalid',salary:'45000.00'};
 const call=(body,method='POST',path='/api/account/vacancy-checkout',session=token)=>localPrimaryPaymentHandler(request(path,session,{expectedOwnerId:user,...body},method),context);
 async function create(patch={}){return forms.create(token,user,'vacancy',randomUUID(),{...base,...patch});}
 async function quote(item){const response=await call({action:'testPreview',listingId:item.id,expectedRevision:item.revision});assert.equal(response.status,200);return response.json();}
 async function prepare(item,key=randomUUID()){
  const q=await quote(item),body={creationKey:key,listingId:item.id,expectedRevision:item.revision,expectedTariffId:q.tariff.id,expectedAmount:q.tariff.amount,expectedDurationDays:q.tariff.durationDays};
  const response=await call(body,'PUT');assert.equal(response.status,200);return{order:await response.json(),body};
 }
 async function fixture(patch={}){const item=await create(patch),saved=await prepare(item);const response=await call({action:'dispatch',paymentId:saved.order.id});assert.equal(response.status,200);return{item,...saved};}
 const pay=order=>localPrimaryPaymentHandler(request(`/__local/payment?intent=${order.id}&type=vacancy`,token,{action:'succeed'},'POST',true),context);
 const row=async id=>(await owner.query('select status,is_paid,published_at::text,expires_at::text from app.work_publications where id=$1',[id])).rows[0];
 const count=async id=>(await owner.query('select count(*)::int as n from app.payment_fulfillments where intent_id=$1',[id])).rows[0].n;
 const publicStore=new(load('postgres-public-work').PostgresPublicWorkStore)(runtime,{vacancyPostmoderation:true});
 const publicRead=id=>runtime.transaction(tx=>new(load('postgres-public-work').PostgresPublicWorkStore)(tx,{vacancyPostmoderation:true}).read('vacancy',id));
 async function check(name,work){await work();checks++;console.log(JSON.stringify({check:name,status:'passed'}));}
 await check('three employer types preserve private form; restricted runtime can only prepare purchases',async()=>{
  for(const patch of [{},{employerType:'ip',inn:'500100732259',ogrn:'',ogrnip:'',organization:'Иванов Иван Иванович'},
   {employerType:'person',inn:'',ogrn:'',organization:'Иван',contactPerson:null,email:null}]){
   const item=await create(patch),saved=await forms.read(token,user,'vacancy',item.id);assert.deepEqual(saved.form,item.form);assert.equal((await quote(item)).tariff.id,'vacancy-publication');
  }
  await assert.rejects(runtime.transaction(tx=>tx.query("update app.work_publications set is_paid=true where author_id=$1",[user])),error=>error.code==='42501');
 });
 await check('invalid INN and missing employer contacts cannot start payment; partial draft remains saved',async()=>{
  for(const patch of [{inn:'7707083894'},{contactPerson:null},{contactPhone:'123'},{employerType:'person',organization:'123',inn:'',ogrn:''}]){
   if(patch.contactPhone==='123'||patch.employerType==='person'){
    const before=(await owner.query('select count(*)::int as n from app.work_publications where author_id=$1',[user])).rows[0].n;
    await assert.rejects(create(patch),load('work-publication-contract').WorkPublicationInputError);
    assert.equal((await owner.query('select count(*)::int as n from app.work_publications where author_id=$1',[user])).rows[0].n,before);
    continue;
   }
   const item=await create(patch),response=await call({action:'testPreview',listingId:item.id,expectedRevision:item.revision});assert.equal(response.status,409);assert.equal((await row(item.id)).is_paid,false);
  }
 });
 await check('one intent on repeated prepare; listing/vacancy IDs, keys and endpoints cannot be mixed',async()=>{
  const f=await fixture(),again=await call(f.body,'PUT');assert.equal(again.status,200);assert.equal((await again.json()).id,f.order.id);
  for(const body of [{action:'order',paymentId:f.order.id},{action:'intent',creationKey:f.body.creationKey},{action:'dispatch',paymentId:f.order.id}]){
   const response=await call(body,'POST','/api/account/listing-checkout');
   if(body.action==='order'){assert.equal(response.status,200);assert.equal(await response.json(),null);}else assert.notEqual(response.status,200);
  }
  assert.equal((await call({action:'order',paymentId:f.order.id},'POST','/api/account/vacancy-checkout',randomBytes(32).toString('hex'))).status,401);
 });
 await check('pending/cancel never publish, cannot turn canceled payment into success',async()=>{
  const f=await fixture();for(const action of ['pending','cancel','succeed']){
   const response=await localPrimaryPaymentHandler(request(`/__local/payment?intent=${f.order.id}&type=vacancy`,token,{action},'POST',true),context);assert.equal(response.status,200);
   assert.equal((await row(f.item.id)).status,'draft');assert.equal(await count(f.order.id),0);
  }
 });
 await check('captured payment publishes once without fake moderation; public DTO excludes employer contacts; refund hides it',async()=>{
  const f=await fixture();assert.equal((await pay(f.order)).status,200);const before=await row(f.item.id);assert.equal(before.status,'published');assert.equal(before.is_paid,true);assert.equal(await count(f.order.id),1);
  assert.equal((await owner.query('select count(*)::int n from app.work_moderation where publication_id=$1',[f.item.id])).rows[0].n,0);
  const visible=await publicRead(f.item.id);assert.equal(visible.id,f.item.id);assert.equal(visible.phone,undefined);assert.equal(visible.inn,undefined);
  assert.equal((await pay(f.order)).status,200);assert.deepEqual(await row(f.item.id),before);assert.equal(await count(f.order.id),1);
  await owner.query("update app.payment_orders set status='refunded' where id=$1",[f.order.id]);assert.equal(await publicRead(f.item.id),undefined);
  await pay(f.order);assert.equal(await publicRead(f.item.id),undefined);assert.deepEqual(await row(f.item.id),before);
 });
 await check('profession rename preserves identity; disabled references cannot quote or publish after capture',async()=>{
  for(const mode of ['rename','disable']){
   const f=await fixture();await owner.query('savepoint reference_change');
   if(mode==='rename')await owner.query("update app.specialist_categories set name=name||' (переименовано)' where name=$1",[base.professionName]);
   else await owner.query('update app.specialist_categories set active=false where name=$1',[base.professionName]);
   const q=await call({action:'testPreview',listingId:f.item.id,expectedRevision:f.item.revision});
   if(mode==='rename'){
    assert.equal(q.status,200);assert.equal((await pay(f.order)).status,200);
    const placed=await row(f.item.id);assert.equal(placed.is_paid,true);assert.equal(placed.status,'published');assert.equal(await count(f.order.id),1);
    assert.equal((await publicRead(f.item.id)).profession,base.professionName+' (переименовано)');
    assert.equal((await pay(f.order)).status,200);assert.deepEqual(await row(f.item.id),placed);assert.equal(await count(f.order.id),1);
   }else{
    assert.equal(q.status,409);
    assert.equal((await pay(f.order)).status,200);assert.equal((await row(f.item.id)).is_paid,false);assert.equal(await count(f.order.id),0);
   }
   await owner.query('rollback to savepoint reference_change');await owner.query('release savepoint reference_change');
  }
 });
 // Arrange historical damage before inserting its old immutable payment; never disable live guards.
 async function historicalFixture(mode){
  const item=await create(),q=await quote(item);
  if(mode==='edit')await forms.update(token,user,'vacancy',item.id,item.revision,{...item.form,title:'Изменённая вакансия'});
  else await trusted.transaction(tx=>tx.query('update app.work_publications set deleted_at=clock_timestamp() where id=$1',[item.id]));
  const id=randomUUID(),providerId=randomUUID(),binding={id,ownerId:user,targetType:'vacancy',targetId:item.id,targetRevision:item.revision,tariffId:q.tariff.id,amount:q.tariff.amount,durationDays:q.tariff.durationDays,shopId:'local-fixture-shop',isTest:true};
  const requestBody=JSON.stringify({amount:{value:binding.amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:origin+'/oplata/'+id},metadata:{localPaymentId:id,targetId:item.id,targetType:'vacancy',tariffId:binding.tariffId}});
  const intents=new(load('postgres-payment-intents').PostgresPaymentIntentStore)(trusted);
  await trusted.transaction(async tx=>{await intents.persistInTransaction(tx,{...binding,requestBody});await tx.query('insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,$4,$5,$6::bigint)',[id,user,randomUUID(),'vacancy',item.id,item.revision]);});
  await intents.authorize(binding);await owner.query("insert into local_primary.provider_payments(intent_id,provider_id,status) values($1,$2,'pending')",[id,providerId]);await intents.bindProvider(binding,providerId);
  return{item,order:{id}};
 }
 await check('active checkout prevents edits and deletion without losing the saved draft or purchase',async()=>{
  const f=await fixture(),orderBefore=(await owner.query('select * from app.payment_orders where id=$1',[f.order.id])).rows[0],before=await forms.read(token,user,'vacancy',f.item.id);
  await assert.rejects(forms.update(token,user,'vacancy',f.item.id,f.item.revision,{...f.item.form,title:'Изменённая вакансия'}),error=>error.code==='PBL01');
  await assert.rejects(trusted.transaction(tx=>tx.query('update app.work_publications set deleted_at=clock_timestamp() where id=$1',[f.item.id])),error=>error.code==='PBL01');
  assert.deepEqual(await forms.read(token,user,'vacancy',f.item.id),before);assert.deepEqual((await owner.query('select * from app.payment_orders where id=$1',[f.order.id])).rows[0],orderBefore);assert.equal(await count(f.order.id),0);
 });
 await check('edited or deleted draft after dispatch returns explicit blocked with durable payment and no publication',async()=>{
  for(const mode of ['edit','delete']){
   const f=await historicalFixture(mode);
   const response=await pay(f.order);assert.equal(response.status,200);assert.match(await response.text(),/target_changed/);
   assert.equal((await row(f.item.id)).is_paid,false);assert.equal(await count(f.order.id),0);
   assert.equal((await owner.query('select status from app.payment_orders where id=$1',[f.order.id])).rows[0].status,'succeeded');
  }
 });
 // Force evaluation of public list SQL under the actual restricted role as well.
 await runtime.transaction(tx=>new(load('postgres-public-work').PostgresPublicWorkStore)(tx,{vacancyPostmoderation:true}).list('vacancy'));
 assert.ok(publicStore);
 console.log(JSON.stringify({status:'passed',checks,runtimeRole:'blizhniy_runtime',realCharges:false,productionTouched:false,fixtures:'rolled-back'}));
}finally{try{await owner.query('rollback');}finally{await owner.end();for(const key of keys){if(oldEnv[key]===undefined)delete process.env[key];else process.env[key]=oldEnv[key];}}}
