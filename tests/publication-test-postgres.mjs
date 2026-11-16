// Disposable PostgreSQL, synthetic identities and provider responses; no production credentials or network.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,randomUUID,randomInt} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import pg from 'pg';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const run=promisify(execFile),image='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const name='blizhniy-publication-test-'+randomBytes(8).toString('hex'),label='blizhniy.publication-test-fixture',password=randomBytes(32).toString('hex');
const docker=async args=>(await run('/usr/bin/docker',['--host','unix:///var/run/docker.sock',...args],{timeout:20000,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',POSTGRES_PASSWORD:password}})).stdout.trim();

test('production-shaped TEST admission: new marked payments publish each placement once; old TEST and other owners never publish',{timeout:90000},async suite=>{
 let container,admin,db;const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('External network forbidden');};
 const variables=['BLIZHNIY_AUTH_MODE','BLIZHNIY_AUTH_ORIGIN','BLIZHNIY_LISTING_WORKFLOW','BLIZHNIY_LOCAL_PRIMARY'];
 const saved=Object.fromEntries(variables.map(k=>[k,process.env[k]]));Object.assign(process.env,{BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',BLIZHNIY_LISTING_WORKFLOW:'postmoderation'});delete process.env.BLIZHNIY_LOCAL_PRIMARY;
 try{
  container=await docker(['run','--detach','--pull','never','--name',name,'--label',label+'='+name,'--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_test',image]);
  const metadata=JSON.parse(await docker(['inspect',container]))[0];assert.equal(metadata.Id,container);assert.equal(metadata.Config.Labels[label],name);assert.equal(metadata.Config.Image,image);
  const binding=metadata.NetworkSettings.Ports['5432/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');const config={host:'127.0.0.1',port:Number(binding.HostPort),database:'blizhniy_test',user:'postgres',password,ssl:false,connectionTimeoutMillis:3000};
  const deadline=Date.now()+20000;for(;;){try{await docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','blizhniy_test']);break;}catch{assert.ok(Date.now()<deadline);}await new Promise(r=>setTimeout(r,100));}
  admin=new pg.Pool({...config,max:3});db=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,max:4}));
  const migrations=(await readdir(new URL('../database/migrations/',import.meta.url))).filter(n=>/^\d{4}-[a-z-]+\.sql$/.test(n)&&n<'0034').sort();assert.equal(migrations.length,33);
  for(const n of migrations)await admin.query(await readFile(new URL('../database/migrations/'+n,import.meta.url),'utf8'));
  await admin.query("insert into app.regions(slug,name) values('krasnodarskiy-kray','Краснодарский край');insert into app.cities(region_id,slug,name) select id,'krasnodar','Краснодар' from app.regions;insert into app.categories(slug,name) values('otdyh','Хобби и отдых');insert into app.specialist_categories(slug,name,parent_name) values('plumber','Сантехник','Строительство');insert into app.tariffs(id,action,name,price,duration_days) values('listing-publication','listing_publication','Объявление',199,30),('vacancy-publication','vacancy_publication','Вакансия',199,30),('work-request-publication','work_request_publication','Заказ',199,30)");
  const city=(await admin.query('select id from app.cities')).rows[0].id,category=(await admin.query('select id from app.categories')).rows[0].id,profession=(await admin.query('select id from app.specialist_categories')).rows[0].id;
  async function actor(){
   const owner=randomUUID(),phone='+7999'+String(randomInt(10000000)).padStart(7,'0'),token=randomBytes(32).toString('hex');
   await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[owner,owner+'@publication.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
   await admin.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2)',[owner,{name:'Тестовый пользователь',phone}]);await admin.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[owner,phone,'test-'+owner]);
   await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[load('identity').hashSessionToken(token),owner]);return{owner,phone,token};
  }
  const current=await actor(),other=await actor(),merchant={shopId:'publication-fixture',isTest:true,secretKey:'test_synthetic_only'},checkout={...merchant,siteOrigin:process.env.BLIZHNIY_AUTH_ORIGIN,receiptVatCode:1};
  async function draft(kind,actor=current){
   const target=kind==='listing'?(await admin.query("insert into app.listings(author_id,listing_type,category_id,city_id,title,description,contact_phone) values($1,'sell',$2,$3,'ТЕСТ: новое размещение','Синтетический прогон нового размещения.',$4) returning id,revision::text",[actor.owner,category,city,actor.phone])).rows[0]:
    (await admin.query('insert into app.work_publications(author_id,kind,creation_key,form,city_id,profession_id) values($1,$2,$3,$4,$5,$6) returning id,revision::text',[actor.owner,kind,randomUUID(),load('work-publication-contract').parseWorkPublicationForm(kind,{kind,title:'ТЕСТ: новое размещение',description:'Синтетический прогон нового размещения.',cityName:'Краснодар',professionName:'Сантехник',professionId:profession,contactPhone:actor.phone,placementRightConfirmed:true,...(kind==='vacancy'?{employerType:'person',organization:'Иван Иванов',salary:'3500'}:{budget:'3500'})}),city,profession])).rows[0];
   return{...actor,...target,kind};
  }
  const Store=load('postgres-listing-checkout').PostgresListingCheckoutStore;
  const store=kind=>new Store(db,checkout,{postmoderation:true,...(kind==='listing'?{}:{targetType:kind}),publicationTestOwner:current.owner});
  const provider=new Map();let posts=0,gets=0;
  const fetcher=async(url,init)=>{
   assert.equal(new URL(url).origin,'https://api.yookassa.ru');
   if(init.method==='POST'){
    posts++;const body=JSON.parse(init.body);assert.equal(body.metadata.publicationMode,'account-test-v1');const id=randomUUID();provider.set(id,{body,status:'succeeded'});
    return Response.json({id,status:'pending',paid:false,test:true,recipient:{account_id:merchant.shopId},amount:body.amount,metadata:body.metadata,confirmation:{type:'redirect',confirmation_url:'https://yoomoney.ru/checkout'}});
   }
   assert.equal(init.method,'GET');gets++;const id=new URL(url).pathname.split('/').at(-1),entry=provider.get(id);assert.ok(entry);return Response.json({id,status:entry.status,paid:entry.status==='succeeded',test:true,recipient:{account_id:merchant.shopId},amount:entry.body.amount,metadata:entry.body.metadata,...(entry.status==='succeeded'?{captured_at:new Date().toISOString()}:{})});
  };
  const worker=load('payment-reconciliation-worker').createPaymentReconciliationWorker(db,merchant,fetcher,current.owner);
  for(const kind of ['listing','vacancy','workRequest'])await suite.test(kind+': immutable admission, session owner, provider binding, one fulfillment and stable readback',async()=>{
   const d=await draft(kind),s=store(kind),quote=await s.preview(d.token,d.owner,d.id,d.revision),input={listingId:d.id,expectedRevision:d.revision,creationKey:randomUUID(),expectedTariffId:quote.tariff.id,expectedAmount:quote.tariff.amount,expectedDurationDays:quote.tariff.durationDays};
   const order=await s.prepare(d.token,d.owner,input);assert.deepEqual(await s.prepare(d.token,d.owner,input),order);
   const raw=(await admin.query('select request_body from app.payment_checkout_intents where id=$1',[order.id])).rows[0].request_body;assert.equal(JSON.parse(raw).metadata.publicationMode,'account-test-v1');
   await assert.rejects(s.preview(other.token,other.owner,d.id,d.revision));
   const payment=load('account-test-listing-payment').createAccountTestListingPayment(db,s,{...merchant,ownerId:current.owner},fetcher);await payment.dispatch(d.token,d.owner,order.id);
   assert.deepEqual(await worker.tick(),{state:'completed'});const read=await s.readOrder(d.token,d.owner,order.id);assert.equal(read.order.status,'succeeded');assert.ok(read.fulfillment);
   const fulfillment=new(load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(db,merchant,{postmoderation:true,publicationTestOwner:current.owner,...(kind==='listing'?{}:{targetType:kind})});assert.equal((await fulfillment.fulfill(order.id)).state,'fulfilled');assert.deepEqual(await s.readOrder(d.token,d.owner,order.id),read);
   assert.equal((await admin.query('select count(*)::int n from app.payment_fulfillments where intent_id=$1',[order.id])).rows[0].n,1);
   const publicRow=kind==='listing'?await new(load('postgres-public-listings').PostgresPublicListingStore)(db,{postmoderation:true}).read(d.id):await new(load('postgres-public-work').PostgresPublicWorkStore)(db,{vacancyPostmoderation:true}).read(kind,d.id);
   assert.ok(publicRow);assert.match(publicRow.title,/^ТЕСТ · /);
   assert.deepEqual(await worker.tick(),{state:'idle'});
  });
  await suite.test('old unmarked TEST success cannot enter discovery, claim or direct publication',async()=>{
   const d=await draft('listing'),s=new Store(db,checkout,{postmoderation:true}),q=await s.preview(d.token,d.owner,d.id,d.revision),order=await s.prepare(d.token,d.owner,{listingId:d.id,expectedRevision:d.revision,creationKey:randomUUID(),expectedTariffId:q.tariff.id,expectedAmount:q.tariff.amount,expectedDurationDays:q.tariff.durationDays});
   assert.equal(JSON.parse((await admin.query('select request_body from app.payment_checkout_intents where id=$1',[order.id])).rows[0].request_body).metadata.publicationMode,undefined);
   await assert.rejects(store('listing').authorizeDispatch(d.token,d.owner,order.id),{name:'ListingCheckoutUnavailableError'});
   assert.equal((await admin.query('select count(*)::int n from app.payment_dispatch_anchors where intent_id=$1',[order.id])).rows[0].n,0);
   const b=await s.authorizeDispatch(d.token,d.owner,order.id),providerId=randomUUID(),intents=new(load('postgres-payment-intents').PostgresPaymentIntentStore)(db);await intents.authorize(b);await intents.bindProvider(b,providerId);
   await admin.query("update app.payment_orders set status='succeeded' where id=$1",[order.id]);
   assert.deepEqual(await worker.tick(),{state:'idle'});
   const fulfillment=new(load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(db,merchant,{postmoderation:true,publicationTestOwner:current.owner});assert.deepEqual(await fulfillment.fulfill(order.id),{state:'blocked',reason:'publication_not_admitted'});
   assert.equal((await admin.query('select count(*)::int n from app.payment_fulfillments where intent_id=$1',[order.id])).rows[0].n,0);
  });
  assert.equal(posts,3);assert.equal(gets,3);
 }finally{
  for(const key of variables){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}globalThis.fetch=originalFetch;
  await db?.close();await admin?.end();if(container){const metadata=JSON.parse(await docker(['inspect',container]))[0];assert.equal(metadata.Id,container);assert.equal(metadata.Config.Labels[label],name);await docker(['rm','--force','--volumes',container]);}
 }
});
