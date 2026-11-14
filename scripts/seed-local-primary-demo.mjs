import {readMediaRetentionEnabled} from '../src/lib/media-retention-config.ts';
// One explicit local-only fixture setup for manual review. Paid state is reached
// through the same immutable intent -> simulator -> verification -> fulfillment
// stores, never by assigning publication/payment columns directly.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import pg from 'pg';
import {prepareLocalPrimaryFixture,stateDirectory,localPrimaryDatabaseConfig} from './local-primary-fixture.mjs';
import {localPrimaryPaymentHandler} from './local-primary-payment.mjs';
const load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
const state=await prepareLocalPrimaryFixture();
Object.assign(process.env,{NODE_ENV:'test',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:state.origin,BLIZHNIY_LISTING_WORKFLOW:'postmoderation'});
const file=join(stateDirectory,'demo-seed-plan.json');
try{await readFile(file);throw Error('Demo seed already started; inspect the owned plan before repeating');}catch(error){if(error.code!=='ENOENT')throw error;}
const plan={version:1,phase:'prepared',uploadIntent:randomUUID(),items:[
 {key:randomUUID(),title:'Домашний комод — черновик',amount:'3500.00',target:'draft'},
 {key:randomUUID(),title:'Мебель для дома — опубликовано',amount:'5400.00',target:'published'},
 {key:randomUUID(),title:'Пример объявления с нарушением',amount:'3200.00',target:'blocked'},
]};
await writeFile(file,JSON.stringify(plan),{mode:0o600,flag:'wx'});
const {PostgresDatabase}=load('postgres');
const runtimeDb=new PostgresDatabase(new pg.Pool(localPrimaryDatabaseConfig(state))),ownerDb=new PostgresDatabase(new pg.Pool(localPrimaryDatabaseConfig(state,'owner')));
const identity=new(load('identity').IdentityStore)(runtimeDb);let userSession,adminSession;
const origin='https://xn----9sbphbgks4a4a.xn--p1ai';
const request=(path,token,body,method='POST',form=false)=>new Request(origin+path,{method,headers:{host:new URL(origin).host,origin,'sec-fetch-site':'same-origin','content-type':form?'application/x-www-form-urlencoded':'application/json','x-blizhniy-request':'1','x-real-ip':'127.0.0.1',cookie:'__Host-blizhniy_session='+token},body:form?new URLSearchParams(body):JSON.stringify(body)});
try{
 const accounts=JSON.parse(await readFile(join(stateDirectory,'accounts.json'),'utf8')),user=accounts.find(item=>item.role==='user'),admin=accounts.find(item=>item.role==='admin');
 userSession=await identity.login(user.email,user.password);adminSession=await identity.login(admin.email,admin.password);assert.ok(userSession&&adminSession);
 const files=await load('media-files').createLocalMediaFileStore(join(stateDirectory,'media'));
 const repository=new(load('media-metadata').MediaMetadataRepository)(runtimeDb,files,readMediaRetentionEnabled());
 const writer=await load('media-file-worker').createLocalMediaFileWorker(state.project,join(stateDirectory,'media'));
 const upload=new(load('media-upload').LocalMediaUpload)(repository,load('media-worker').createLocalMediaWorker(state.project),new(load('media-write').LocalMediaWriter)(repository,writer));
 const photo=await upload.upload(userSession.token,plan.uploadIntent,await readFile(join(state.project,'public/images/categories/home-dacha-category-hero.png')),'image/png');
 plan.photoId=photo.id;plan.phase='photo_ready';await writeFile(file,JSON.stringify(plan),{mode:0o600});
 const category=(await ownerDb.query("select slug from app.categories where parent_id is null and active order by case when slug like '%dom%' then 0 else 1 end,sort_order limit 1")).rows[0].slug;
 const drafts=new(load('postgres-listing-drafts').PostgresListingDraftStore)(runtimeDb),forms=new(load('postgres-listing-form').PostgresListingFormStore)(runtimeDb,{contactMethod:true});
 const context={state,ownerDb,runtimeDb,load};
 for(const item of plan.items){
  const empty=await drafts.createEmpty(userSession.token,user.id,item.key);
  const saved=await forms.update(userSession.token,user.id,empty.id,empty.revision,{kind:'prodam',title:item.title,description:'Локальный пример для ручной проверки карточки, фотографий и статуса. Это синтетическое предложение, не настоящее объявление о продаже.',price:item.amount,
   categorySlug:category,cityName:'Краснодар',district:'Центральный',contactPhone:'+79990000000',photoIds:[photo.id]});
  Object.assign(item,{id:saved.id,revision:saved.revision});await writeFile(file,JSON.stringify(plan),{mode:0o600});
  if(item.target!=='draft'){
   const preview=await localPrimaryPaymentHandler(request('/api/account/listing-checkout',userSession.token,{action:'testPreview',expectedOwnerId:user.id,listingId:saved.id,expectedRevision:saved.revision}),context);assert.equal(preview.status,200);const quote=await preview.json();
   const prepared=await localPrimaryPaymentHandler(request('/api/account/listing-checkout',userSession.token,{expectedOwnerId:user.id,creationKey:randomUUID(),listingId:saved.id,expectedRevision:saved.revision,expectedTariffId:quote.tariff.id,expectedAmount:quote.tariff.amount,expectedDurationDays:quote.tariff.durationDays},'PUT'),context);assert.equal(prepared.status,200);const order=await prepared.json();item.orderId=order.id;await writeFile(file,JSON.stringify(plan),{mode:0o600});
   const dispatch=await localPrimaryPaymentHandler(request('/api/account/listing-checkout',userSession.token,{action:'dispatch',expectedOwnerId:user.id,paymentId:order.id}),context);assert.equal(dispatch.status,200);
   const paid=await localPrimaryPaymentHandler(request('/__local/payment?intent='+order.id,userSession.token,{action:'succeed'},'POST',true),context);assert.equal(paid.status,200);
   const row=(await ownerDb.query('select status,is_paid from app.listings where id=$1',[saved.id])).rows[0];assert.deepEqual(row,{status:'published',is_paid:true});
   if(item.target==='blocked'){
    const limiter=new(load('auth-http').AuthRateLimiter)(runtimeDb,state.rateSecret),store=new(load('postgres-listing-management').PostgresListingManagementStore)(runtimeDb,files);
    const handler=load('admin-listing-management-http').createAdminListingManagementHandler({origin},()=>({limiter,store}));
    const result=await handler(request('/api/admin/listing-management',adminSession.token,{action:'block',expectedAdminId:admin.id,listingId:saved.id,expectedRevision:saved.revision,reason:'Демонстрационная блокировка: объявление нарушает правила размещения. Пример для проверки уведомления владельцу.'}));assert.equal(result.status,200);
   }
  }
  item.completed=true;await writeFile(file,JSON.stringify(plan),{mode:0o600});
 }
 const cards=await new(load('postgres-listing-cabinet').PostgresListingCabinetStore)(runtimeDb,true).list(userSession.token,user.id,null);
 for(const item of plan.items)assert.equal(cards.items.find(card=>card.id===item.id)?.card.status,item.target);
 plan.phase='completed';await writeFile(file,JSON.stringify(plan),{mode:0o600});
 console.log(JSON.stringify({result:'passed',demoAds:3,statuses:['draft','published','blocked'],photos:'real_private_normalized',realCharges:false,productionTouched:false}));
}finally{
 if(userSession)await identity.revokeSession(userSession.token);if(adminSession)await identity.revokeSession(adminSession.token);
 await runtimeDb.close();await ownerDb.close();
}
