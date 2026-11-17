// Explicit owned-local HTTP acceptance. Synthetic fixtures stay private and blocked after the run.
import assert from 'node:assert/strict';
import {randomUUID,randomInt,createHmac} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdtemp,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {request} from 'node:https';
import pg from 'pg';
import {stateFile,stateDirectory,localPrimaryDatabaseConfig,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
import {createLocalPrimaryHttpsClient} from './local-primary-https.mjs';

assert.deepEqual(process.argv.slice(2),['--run']);assert.equal(process.env.NODE_ENV,'test');
const root=process.cwd(),state=readLocalPrimaryState(stateFile,root);assert.equal(state.origin,'https://127.0.0.1:3045');
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const ca=await readFile(join(stateDirectory,'tls-cert.pem')),load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
const db=new pg.Client({...localPrimaryDatabaseConfig(state,'owner'),ssl:{ca:await readFile(join(stateDirectory,'refund-db-ca.pem'),'utf8'),rejectUnauthorized:true},statement_timeout:3000});
const directory=await mkdtemp(join(stateDirectory,'core-https-'));await chmod(directory,0o700);
const build=(await readFile(join(root,'.next/BUILD_ID'),'utf8')).trim(),actors=[],targets=[],checks=[];let stage='preflight',failure,cleaned=false,requestCount=0;
const put=(name,value)=>writeFile(join(directory,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
const check=(name,value=true)=>{assert.ok(value,name);checks.push(name);};
const client=()=>createLocalPrimaryHttpsClient(ca,(...args)=>{requestCount++;return request(...args);});
const publicApi=client();
async function account(name,role='user',confirmed=true){
 const actor={id:randomUUID(),email:'core-http-'+randomUUID()+'@local.invalid',password:'SyntheticHttp-'+randomUUID()+'!',phone:'+7999'+randomInt(1000000,9999999),api:client()};
 const passwordHash=await load('identity').hashPassword(actor.password);actors.push(actor);
 await db.query('begin');try{
  await db.query('insert into app.users(id,email,password_hash,role,email_verified_at) values($1,$2,$3,$4,clock_timestamp())',[actor.id,actor.email,passwordHash,role]);
  await db.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)',[actor.id,JSON.stringify(load('postgres-profile').parseProductionProfile({name,phone:actor.phone,city:'Краснодар'}))]);
  if(confirmed)await db.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[actor.id,actor.phone,'synthetic-core-http-'+actor.id]);
  await db.query('commit');
 }catch(error){await db.query('rollback');throw error;}
 await login(actor);return actor;
}
async function login(actor){const response=await actor.api('/api/account/login',{body:{email:actor.email,password:actor.password,captchaToken:''}});assert.equal(response.data.user.id,actor.id);}
async function api(actor,path,body={},method='POST',expected=200,options={}){
 return (await actor.api(path,{method,expected,body:{expectedOwnerId:actor.id,...body},...options})).data;
}
const period=async id=>(await db.query('select published_at::text,expires_at::text from app.payment_fulfillments where intent_id=$1',[id])).rows;
const rows=async id=>(await db.query(`select (select count(*)::int from app.payment_dispatch_anchors where intent_id=$1) anchors,
 (select count(*)::int from app.payment_provider_links where intent_id=$1) links,(select count(*)::int from local_primary.provider_payments where intent_id=$1) providers`,[id])).rows[0];
const paths={listing:'/obyavlenie/',vacancy:'/vakansiya/',workRequest:'/rabota/zakazy/',specialist:'/specialist/'};
const checkoutPath=kind=>'/api/account/'+({listing:'listing',vacancy:'vacancy',workRequest:'work-request',specialist:'specialist'}[kind])+'-checkout';
async function approve(author,admin,item){
 const review=await api(author,'/api/account/service-moderation',{kind:'specialist',publicationId:item.id,expectedRevision:item.revision},'PUT');assert.equal(review.state,'pending');
 const result=await admin.api('/api/admin/service-moderation',{method:'PUT',body:{expectedAdminId:admin.id,kind:'specialist',requestId:review.id,state:'approved',note:null}});assert.equal(result.data.state,'approved');
}
async function journey(author,peer,admin,kind){
 stage=kind+'-draft';const prefix=name=>check(kind+'-'+name),key=randomUUID(),specialist=kind==='specialist',listing=kind==='listing';
 const resource=listing?'/api/account/listing-form':specialist?'/api/account/service-publications':'/api/account/work-publications';
 let item,form={kind:listing?'prodam':kind,title:'Проверка HTTPS размещения',description:'Синтетическая проверка сохранения и публикации размещения.',cityName:'Краснодар',contactPhone:author.phone,photoIds:[],
  ...(listing?{price:'3500.00',categorySlug:'otdyh'}:{professionName:'Сантехник',placementRightConfirmed:true,...(specialist?{price:'1500',email:'synthetic@example.invalid'}:kind==='vacancy'?{employerType:'person',organization:'Синтетический Автор',salary:'45000',schedule:'5/2',workFormat:'На месте'}:{budget:'3500'})})};
 if(listing){
  const draft=await api(author,'/api/account/listing-drafts/collection',{creationKey:key},'PUT');
  assert.equal((await api(author,'/api/account/listing-drafts/collection',{creationKey:key},'PUT')).id,draft.id);
  targets.push({kind,id:draft.id,publicPath:paths[kind]+draft.id});
  item=await api(author,resource,{listingId:draft.id,expectedRevision:draft.revision,form},'PUT');
 }else{
  const body={action:'create',kind,creationKey:key,form};item=await api(author,resource,body,'PUT');targets.push({kind,id:item.id,publicPath:paths[kind]+item.id});
  assert.equal((await api(author,resource,body,'PUT')).id,item.id);
 }
 prefix('idempotent-draft');const target=targets.at(-1);
 const read=(actor=author)=>api(actor,resource,listing?{listingId:item.id}:{action:'read',kind,publicationId:item.id});
 const update=(snapshot,next,expected=200)=>api(author,resource,listing?{listingId:item.id,expectedRevision:snapshot.revision,form:next}:{action:'update',kind,publicationId:item.id,expectedRevision:snapshot.revision,form:next},'PUT',expected);
 assert.deepEqual((await read()).form,item.form);prefix('saved-draft-readback');
 if(listing){await author.api('/api/account/logout');author.api=client();await login(author);assert.deepEqual((await read()).form,item.form);prefix('draft-survives-new-login');}
 await api(peer,resource,listing?{listingId:item.id}:{action:'read',kind,publicationId:item.id},'POST',404);prefix('private-to-owner');
 await publicApi(target.publicPath,{method:'GET',expected:404});prefix('unpaid-not-public');
 const previous=item;item=await update(item,{...item.form,description:item.form.description+' Проверено повторное сохранение.'});
 await update(previous,previous.form,409);prefix('stale-editor-denied');
 stage=kind+'-payment';const checkout=checkoutPath(kind);
 if(specialist){await api(author,checkout,{action:'testPreview',listingId:item.id,expectedRevision:item.revision},'POST',409);await approve(author,admin,item);prefix('moderation-required-before-checkout');}
 const offer=await api(author,checkout,{action:'testPreview',listingId:item.id,expectedRevision:item.revision});
 const prepare=()=>({creationKey:randomUUID(),listingId:item.id,expectedRevision:item.revision,expectedTariffId:offer.tariff.id,expectedAmount:offer.tariff.amount,expectedDurationDays:offer.tariff.durationDays});
 if(!specialist){
  const cancelled=await api(author,checkout,prepare(),'PUT');target.cancelledPaymentId=cancelled.id;
  const cancel={paymentId:cancelled.id,targetType:kind};await api(author,'/api/account/checkout-cancellation',cancel,'PUT');await api(author,'/api/account/checkout-cancellation',cancel,'PUT');
  await api(author,checkout,{action:'dispatch',paymentId:cancelled.id},'POST',409);
  assert.deepEqual(await period(cancelled.id),[]);assert.deepEqual(await rows(cancelled.id),{anchors:0,links:0,providers:0});prefix('cancelled-preparation-never-dispatched');
 }
 const input=prepare();await api(author,checkout,input,'PUT',200,{loseBody:true});
 const order=await api(author,checkout,{action:'intent',creationKey:input.creationKey});assert.ok(order.id);target.paymentId=order.id;prefix('lost-prepare-recovered');
 await update(item,item.form,409);prefix('edit-fenced-during-payment');
 assert.equal(await api(peer,checkout,{action:'order',paymentId:order.id}),null);prefix('order-private');
 await api(author,checkout,{action:'dispatch',paymentId:order.id},'POST',200,{loseBody:true});await api(author,checkout,{action:'dispatch',paymentId:order.id});
 assert.deepEqual(await rows(order.id),{anchors:1,links:1,providers:1});prefix('lost-dispatch-one-provider');
 const payment='/__local/payment?intent='+order.id+(listing?'':'&type='+kind);
 await author.api(payment,{body:{action:'pending'},form:true});assert.deepEqual(await period(order.id),[]);prefix('pending-not-published');
 await author.api(payment,{body:{action:'succeed'},form:true,loseBody:true});
 const paid=await api(author,checkout,{action:'order',paymentId:order.id}),before=await period(order.id);assert.equal(paid.order.status,'succeeded');assert.ok(paid.fulfillment);assert.equal(before.length,1);prefix('capture-publishes-once');
 await author.api(payment,{body:{action:'succeed'},form:true});assert.deepEqual(await period(order.id),before);assert.deepEqual(await rows(order.id),{anchors:1,links:1,providers:1});prefix('capture-replay-keeps-term');
 const visible=await publicApi(target.publicPath,{method:'GET'});assert.ok(visible.data.includes(item.form.title));
 if(kind==='vacancy'||kind==='workRequest'){assert.equal(visible.data.includes(author.phone.slice(1)),false);assert.equal(visible.data.includes(author.email),false);}prefix('public-after-payment-with-safe-contacts');
 stage=kind+'-owner-actions';item=await read();item=await update(item,{...item.form,description:item.form.description+' Изменение после оплаты.'});
 if(specialist){
  await publicApi(target.publicPath,{method:'GET',expected:404});await api(author,checkout,{action:'order',paymentId:order.id});await publicApi(target.publicPath,{method:'GET',expected:404});
  await approve(author,admin,item);prefix('paid-edit-requires-fresh-moderation');
 }
 await publicApi(target.publicPath,{method:'GET'});assert.deepEqual(await period(order.id),before);prefix('paid-edit-without-repayment');
 if(!specialist){
  for(const action of ['withdraw','restore']){
   item=await read();await api(author,listing?'/api/account/listing-actions':'/api/account/work-actions',listing?{listingId:item.id,expectedRevision:item.revision,action}:
    {operationId:randomUUID(),publicationId:item.id,kind,expectedRevision:item.revision,action,reason:action==='restore'?null:'Синтетическая проверка снятия'});
   await publicApi(target.publicPath,{method:'GET',expected:action==='withdraw'?404:200});assert.deepEqual(await period(order.id),before);prefix(action+'-keeps-paid-term');
  }
  item=await read();
  if(listing){
   await api(author,'/api/account/listing-removal',{action:'remove',listingId:item.id,expectedRevision:item.revision},'POST',404);prefix('active-listing-removal-denied');
   await admin.api('/api/admin/listing-management',{body:{action:'block',expectedAdminId:admin.id,listingId:item.id,expectedRevision:item.revision,reason:'Синтетическая проверка блокировки и удаления из кабинета'}});prefix('administrator-blocks-listing');
  }
  await api(author,listing?'/api/account/listing-removal':'/api/account/work-actions',listing?{action:'remove',listingId:item.id,expectedRevision:item.revision}:
   {operationId:randomUUID(),publicationId:item.id,kind,expectedRevision:item.revision,action:'remove',reason:'Синтетическая проверка удаления'});
  await publicApi(target.publicPath,{method:'GET',expected:404});assert.deepEqual(await period(order.id),before);prefix('removed-target-keeps-financial-history');
 }
}
async function cleanup(){
 const errors=[];
 for(const actor of actors){
  try{await actor.api('/api/account/logout');}catch{errors.push('logout');}
  try{await db.query('begin');await db.query('update app.users set is_blocked=true where id=$1',[actor.id]);await db.query('delete from app.sessions where user_id=$1',[actor.id]);await db.query('commit');}
  catch{await db.query('rollback');errors.push('block-synthetic-actor');}
 }
 for(const target of targets)try{await publicApi(target.publicPath,{method:'GET',expected:404});}catch{errors.push('hide-synthetic-publication');}
 assert.deepEqual(errors,[],'Synthetic cleanup failed');cleaned=true;
}
try{
 await db.connect();await publicApi('/api/ready',{method:'GET'});
 // Do not erase counters or bypass shared limits to make acceptance pass.
 for(const [scope,needed,limit] of [['session',220,300],['credential',6,20]]){
  const digest=createHmac('sha256',state.rateSecret).update('production:'+scope+':ip:127.0.0.1').digest('hex');
  const used=(await db.query('select attempts from app.auth_rate_limits where key_hash=$1 and window_start=to_timestamp(floor(extract(epoch from clock_timestamp())/900)*900)',[digest])).rows[0]?.attempts??0;
  assert.ok(used+needed<=limit,'Wait for the existing local auth window before running this suite');
 }
 const author=await account('Синтетический Автор'),peer=await account('Синтетический Специалист'),admin=await account('Синтетический Администратор','admin'),unconfirmed=await account('Синтетический Новичок','user',false);
 stage='phone-admission';
 const restricted=await api(unconfirmed,'/api/account/work-publications',{action:'create',kind:'workRequest',creationKey:randomUUID(),form:{kind:'workRequest',title:'Проверка подтверждения телефона',description:'Синтетический заказ для проверки обязательного телефона.',professionName:'Сантехник',cityName:'Краснодар',contactPhone:unconfirmed.phone,placementRightConfirmed:true,budget:'3500'}},'PUT');
 targets.push({kind:'workRequest',id:restricted.id,publicPath:paths.workRequest+restricted.id});
 const q=await api(unconfirmed,checkoutPath('workRequest'),{action:'testPreview',listingId:restricted.id,expectedRevision:restricted.revision});
 const denied=await api(unconfirmed,checkoutPath('workRequest'),{creationKey:randomUUID(),listingId:restricted.id,expectedRevision:restricted.revision,expectedTariffId:q.tariff.id,expectedAmount:q.tariff.amount,expectedDurationDays:q.tariff.durationDays},'PUT',403);
 assert.equal(denied.error.code,'PHONE_REQUIRED');assert.equal((await db.query('select count(*)::int n from app.payment_orders where owner_id=$1',[unconfirmed.id])).rows[0].n,0);check('unconfirmed-phone-cannot-start-payment');
 for(const kind of ['listing','vacancy','workRequest','specialist'])await journey(author,peer,admin,kind);
 stage='payment-history';
 const history=await api(author,'/api/account/payments',{cursor:null}),other=await api(peer,'/api/account/payments',{cursor:null});
 for(const target of targets.filter(row=>row.paymentId))assert.ok(history.items.some(row=>row.id===target.paymentId&&row.status==='succeeded'));
 assert.equal(history.items.length,7);assert.equal(other.items.length,0);check('payment-history-is-private-and-retains-cancellations');
 stage='cleanup';await cleanup();check('synthetic-actors-blocked-and-public-fixtures-hidden');
 assert.equal((await readFile(join(root,'.next/BUILD_ID'),'utf8')).trim(),build);
 await put('report.json',{passed:true,buildId:build,checks,requestCount,targets,productionTouched:false,realProviderRequests:false,realCharges:false,cleaned});
 console.log(JSON.stringify({passed:true,checks:checks.length,requestCount,buildId:build,report:join(directory,'report.json')}));
}catch(error){failure={stage,code:error?.code??error?.name??'Error',...(Number.isInteger(error?.actual)&&Number.isInteger(error?.expected)?{actual:error.actual,expected:error.expected}:{}),frames:String(error?.stack??'').split('\n').filter(line=>line.trim().startsWith('at ')).slice(0,4)};await put('failed.json',{...failure,checks,targets});throw Error('Local core HTTPS acceptance failed; inspect private report');}
finally{
 try{if(!cleaned&&actors.length)await cleanup();}finally{await put('fixtures.json',{actorIds:actors.map(actor=>actor.id),targets,cleaned,failure});await db.end();}
}
