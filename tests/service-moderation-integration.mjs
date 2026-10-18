import assert from 'node:assert/strict';import {randomBytes,randomUUID} from 'node:crypto';
import {createPostgresDatabase} from '../src/lib/postgres.ts';import {hashSessionToken} from '../src/lib/identity.ts';
import * as contract from '../src/lib/service-publication-contract.ts';import * as decisions from '../src/lib/work-moderation-contract.ts';
import {workPublicationModule} from './work-publication-module.mjs';import {loadAdminModule} from './admin-module.mjs';
import {createRequire} from 'node:module';import * as http from '../src/lib/auth-http.ts';import * as cookie from '../src/lib/account-cookie.ts';import * as proxy from '../src/lib/trusted-proxy-ip.ts';import * as drafts from '../src/lib/listing-draft-contract.ts';
const formsModule=workPublicationModule('postgres-service-publications',{'./service-publication-contract.ts':contract});
export async function testServiceModeration(suite,admin,config,credentials){
 assert.equal(config.host,'127.0.0.1');
 const {PostgresServiceModerationStore}=workPublicationModule('postgres-service-moderation',{'./postgres-service-publications':formsModule,
  './service-publication-contract.ts':contract,'./admin-authorization':loadAdminModule('admin-authorization'),'./work-moderation-contract':decisions});
 const db=createPostgresDatabase({NODE_ENV:'test',BLIZHNIY_DB_HOST:config.host,BLIZHNIY_DB_PORT:String(config.port),BLIZHNIY_DB_NAME:config.database,BLIZHNIY_DB_USER:credentials.user,BLIZHNIY_DB_PASSWORD:credentials.password,BLIZHNIY_DB_SSL_MODE:'disable'});
 let fileReads=0;const store=new PostgresServiceModerationStore(db,{read:async record=>{fileReads++;return Buffer.alloc(record.size);}}),forms=new formsModule.PostgresServicePublicationStore(db),users=[],saved=new Map(),reviews=new Map();
 try{
  for(const role of ['user','admin','admin']){const id=randomUUID(),token=randomBytes(32).toString('hex');users.push({id,token});
   await admin.query('insert into app.users(id,email,password_hash,email_verified_at,role) values($1,$2,$3,clock_timestamp(),$4)',[id,`service-review-${id}@example.invalid`,`scrypt$131072$8$1$${'c'.repeat(32)}$${'d'.repeat(128)}`,role]);
   await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[hashSessionToken(token),id]);}
  const [owner,reviewer,otherAdmin]=users;
  const common={title:'Технический мастер',description:'Синтетическое подробное описание услуги и условий.',cityName:'Краснодар',contactPhone:'+79990000000',email:'synthetic@example.invalid',placementRightConfirmed:true};
  const ready={specialist:{...common,professionName:'Сантехник',price:'1250.50',skills:'Ремонт'},fair:{...common,category:'Посуда'},marquee:{title:'Синтетический рекламный текст',placementRightConfirmed:true}};
  await suite.test('three service kinds require complete current owner forms and share one stable request per revision, without publishing or paying',async()=>{
   const incomplete=await forms.create(owner.token,owner.id,'fair',randomUUID(),{});await assert.rejects(store.submit(owner.token,owner.id,'fair',incomplete.id,incomplete.revision),decisions.WorkModerationInputError);
   for(const kind of ['specialist','fair','marquee']){
    const row=await forms.create(owner.token,owner.id,kind,randomUUID(),ready[kind]);saved.set(kind,row);
    assert.equal((await store.read(owner.token,owner.id,kind,row.id,row.revision)).state,'not_submitted');
    const review=await store.submit(owner.token,owner.id,kind,row.id,row.revision);reviews.set(kind,review);assert.equal(review.state,'pending');
    assert.deepEqual(await store.submit(owner.token,owner.id,kind,row.id,row.revision),review);
    assert.deepEqual(await forms.read(owner.token,owner.id,kind,row.id),row);
   }
  });
  await suite.test('service moderator queues and private inspection verify current admin and kind, exclude self-review and deny foreign ownership',async()=>{
   await assert.rejects(store.list(owner.token,'specialist',null,owner.id),{name:'AdminAccessError'});
   await assert.rejects(store.list(reviewer.token,'specialist',null,otherAdmin.id),{name:'AdminAccessError'});
   for(const kind of ['specialist','fair','marquee']){
    assert.ok((await store.list(reviewer.token,kind,null,reviewer.id)).items.some(item=>item.id===reviews.get(kind).id));
    const inspected=await store.inspect(reviewer.token,kind,reviews.get(kind).id,reviewer.id);assert.deepEqual(inspected.snapshot,saved.get(kind));assert.deepEqual(inspected.issues,[]);
    await assert.rejects(store.read(reviewer.token,owner.id,kind,saved.get(kind).id,'1'),formsModule.ServicePublicationAccessError);
   }
   await assert.rejects(store.inspect(reviewer.token,'fair',reviews.get('marquee').id,reviewer.id),formsModule.ServicePublicationAccessError);
   const own=await forms.create(reviewer.token,reviewer.id,'marquee',randomUUID(),ready.marquee),ownReview=await store.submit(reviewer.token,reviewer.id,'marquee',own.id,own.revision);
   await assert.rejects(store.decide(reviewer.token,'marquee',ownReview.id,'approved',null,reviewer.id),{name:'AdminAccessError'});
   assert.equal((await store.list(reviewer.token,'marquee',null,reviewer.id)).items.some(item=>item.id===ownReview.id),false);
  });
  await suite.test('competing service decisions have one winner and identical replay, never changing payment or public state',async()=>{
   const review=reviews.get('fair'),results=await Promise.allSettled([store.decide(reviewer.token,'fair',review.id,'approved',null,reviewer.id),store.decide(otherAdmin.token,'fair',review.id,'rejected','Уточните материалы.',otherAdmin.id)]);
   const good=results.filter(result=>result.status==='fulfilled'),bad=results.filter(result=>result.status==='rejected');assert.equal(good.length,1);assert.equal(bad.length,1);assert.ok(bad[0].reason instanceof formsModule.ServicePublicationConflictError);
   assert.deepEqual(await store.decide(reviewer.token,'fair',review.id,good[0].value.state,good[0].value.note,reviewer.id),good[0].value);
   assert.deepEqual(await forms.read(owner.token,owner.id,'fair',saved.get('fair').id),saved.get('fair'));
  });
  await suite.test('service edit invalidates prior review; inactive profession may be inspected/rejected but cannot be approved',async()=>{
   const before=saved.get('specialist'),after=await forms.update(owner.token,owner.id,'specialist',before.id,before.revision,{...before.form,experience:'6 лет'});saved.set('specialist',after);
   assert.equal((await store.read(owner.token,owner.id,'specialist',after.id,after.revision)).state,'outdated');await assert.rejects(store.inspect(reviewer.token,'specialist',reviews.get('specialist').id,reviewer.id),formsModule.ServicePublicationConflictError);
   const current=await store.submit(owner.token,owner.id,'specialist',after.id,after.revision);reviews.set('specialist',current);
   await admin.query('update app.specialist_categories set active=false where name=$1',[after.form.professionName]);
   try{assert.ok((await store.inspect(reviewer.token,'specialist',current.id,reviewer.id)).issues.length);await assert.rejects(store.decide(reviewer.token,'specialist',current.id,'approved',null,reviewer.id),decisions.WorkModerationInputError);
    assert.equal((await store.decide(reviewer.token,'specialist',current.id,'rejected','Выберите действующую профессию.',reviewer.id)).state,'rejected');}
   finally{await admin.query('update app.specialist_categories set active=true where name=$1',[after.form.professionName]);}
  });
  await suite.test('service moderation HTTP executes real current-admin decisions and owner readback under restricted SQL without payment side effects',async()=>{
   const {createProductionServiceModerationHandler}=workPublicationModule('production-service-moderation-http',{
    'node:crypto':createRequire(import.meta.url)('node:crypto'),'./auth-http':http,'./account-cookie':cookie,'./trusted-proxy-ip':proxy,'./app-session-transaction':loadAdminModule('app-session-transaction'),
    './admin-authorization':loadAdminModule('admin-authorization'),'./postgres-service-publications':formsModule,'./listing-draft-contract.ts':drafts,'./work-moderation-contract':decisions,'./production-media-http':{productionMediaAdmission:{reads:0}}});
   const origin='https://owned-service-review.example.invalid',runtime=()=>({store,limiter:{allowProduction:async()=>true}}),events=[];
   const endpoint=mode=>createProductionServiceModerationHandler({origin},mode,runtime,event=>events.push(event));
   const request=(actor,body,method='POST')=>new Request(origin+'/api/account/service-moderation',{method,headers:{host:'owned-service-review.example.invalid',origin,'x-real-ip':'192.0.2.5','x-blizhniy-request':'1','content-type':'application/json',cookie:'__Host-blizhniy_session='+actor.token},body:JSON.stringify(body)});
   const review=reviews.get('marquee'),row=saved.get('marquee');
   const denied=await endpoint('admin')(request(owner,{expectedAdminId:owner.id,kind:'marquee',action:'list',after:null}));assert.equal(denied.status,403);
   const decide=await endpoint('admin')(request(reviewer,{expectedAdminId:reviewer.id,kind:'marquee',requestId:review.id,state:'approved',note:null},'PUT'));assert.equal(decide.status,200);assert.equal((await decide.json()).state,'approved');
   const read=await endpoint('owner')(request(owner,{expectedOwnerId:owner.id,kind:'marquee',publicationId:row.id,expectedRevision:row.revision}));assert.equal(read.status,200);assert.equal((await read.json()).state,'approved');
   assert.deepEqual(await forms.read(owner.token,owner.id,'marquee',row.id),row);assert.equal(JSON.stringify(events).includes(owner.token),false);
  });
  await suite.test('service photo inspection checks current review, exact association and ready owner file before filesystem I/O',async()=>{
   const before=saved.get('fair'),media=(await admin.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,gen_random_uuid(),'image/webp',40,20,12,$2) returning id",[owner.id,'f'.repeat(64)])).rows[0].id;
   await admin.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=$1",[media]);
   const after=await forms.update(owner.token,owner.id,'fair',before.id,before.revision,{...before.form,photoIds:[media]}),current=await store.submit(owner.token,owner.id,'fair',after.id,after.revision);
   await assert.rejects(store.readPhoto(reviewer.token,'fair',current.id,randomUUID(),reviewer.id),formsModule.ServicePublicationAccessError);assert.equal(fileReads,0);
   assert.equal((await store.readPhoto(reviewer.token,'fair',current.id,media,reviewer.id)).bytes.length,12);assert.equal(fileReads,1);
   await admin.query('update app.users set is_blocked=true where id=$1',[owner.id]);await assert.rejects(store.inspect(reviewer.token,'fair',current.id,reviewer.id),formsModule.ServicePublicationAccessError);
  });
 }finally{await db.close();}
}
