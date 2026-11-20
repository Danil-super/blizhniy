// Disposable PG18 and synthetic records only. Never reads .env or the shared manual stand.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {promisify} from 'node:util';
import pg from 'pg';
import {getBootstrapPlan} from '../scripts/postgres-migration-plan.mjs';

const require=createRequire(import.meta.url),{loadLocalPrimaryModule:load}=require('../scripts/local-primary-modules.cjs');
const run=promisify(execFile),image='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const name='blizhniy-search-test-'+randomBytes(8).toString('hex'),label='blizhniy.primary-search-integration';
const password=randomBytes(24).toString('hex'),runtimePassword=randomBytes(24).toString('hex');
const docker=async args=>(await run('docker',['--host','unix:///var/run/docker.sock',...args],{
 env:{PATH:process.env.PATH,LANG:'C.UTF-8',POSTGRES_PASSWORD:password},timeout:20000,maxBuffer:1024*1024,
})).stdout.trim();

// Keep this opt-in integration outside the native glob: it owns one tmpfs Docker database.
async function runSearchFixture(suite,benchmark=false){
 const {PostgresPublicSearchStore}=load('postgres-public-search');
 const {PostgresDatabase}=load('postgres');
 const {parseWorkPublicationForm,checkWorkPublicationForm}=load('work-publication-contract');
 const {parseServicePublicationForm,checkServicePublicationForm}=load('service-publication-contract');
 const {PostgresPublicListingStore}=load('postgres-public-listings'),{PostgresPublicWorkStore}=load('postgres-public-work'),{PostgresPublicServiceStore}=load('postgres-public-service');
 let containerId,owner,runtime;
 const keys=['BLIZHNIY_LISTING_WORKFLOW','BLIZHNIY_AUTH_MODE','BLIZHNIY_AUTH_ORIGIN','BLIZHNIY_LOCAL_PRIMARY'],beforeEnv=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 try{
  containerId=await docker(['run','--detach','--pull','never','--name',name,'--label',`${label}=${name}`,'--memory','512m','--cpus','1',
   '--tmpfs','/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_test',image]);
  assert.match(containerId,/^[a-f0-9]{64}$/);
  const metadata=JSON.parse(await docker(['inspect',containerId]))[0];assert.equal(metadata.Id,containerId);assert.equal(metadata.Config.Labels[label],name);
  const binding=metadata.NetworkSettings.Ports['5432/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');
  for(const deadline=Date.now()+20000;;){try{await docker(['exec',containerId,'pg_isready','-h','127.0.0.1','-U','postgres','-d','blizhniy_test']);break;}
   catch{if(Date.now()>deadline)throw Error('Owned search PostgreSQL did not start');}await new Promise(resolve=>setTimeout(resolve,100));}
  const config={host:'127.0.0.1',port:Number(binding.HostPort),database:'blizhniy_test',user:'postgres',password,ssl:false,connectionTimeoutMillis:2000};
  owner=new pg.Client(config);await owner.connect();assert.match((await owner.query("select current_setting('server_version') as version")).rows[0].version,/^18\.6/);
  for(const migration of getBootstrapPlan({includeListingContactMethod:true}))await owner.query(migration.sql);
  await owner.query(await readFile(new URL('../database/migrations/0026-listing-blocks.sql',import.meta.url),'utf8'));
  await owner.query(`create role search_runtime login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password ${pg.escapeLiteral(runtimePassword)};
   revoke all on database blizhniy_test from public;grant connect on database blizhniy_test to search_runtime;grant usage on schema app to search_runtime;
   grant select on app.users,app.cities,app.categories,app.specialist_categories,app.media_objects,app.cabinet_profiles,
    app.listings,app.listing_photos,app.listing_moderation,app.listing_blocks,
    app.work_publications,app.work_publication_photos,app.work_moderation,app.applications,
    app.service_publications,app.service_publication_photos,app.service_moderation to search_runtime`);
  runtime=new PostgresDatabase(new pg.Pool({...config,user:'search_runtime',password:runtimePassword,max:3,statement_timeout:6000,lock_timeout:2000,idle_in_transaction_session_timeout:8000}));
  const search=new PostgresPublicSearchStore(runtime,{specialistProfileIdentity:true});
  const normalListing=new PostgresPublicListingStore(runtime),normalWork=new PostgresPublicWorkStore(runtime),normalService=new PostgresPublicServiceStore(runtime,{specialistProfileIdentity:true});
  const region=(await owner.query("insert into app.regions(slug,name) values('search-region','Синтетический регион') returning id")).rows[0].id;
  const cityIds={};for(const [slug,city]of[['search-krasnodar','Краснодар'],['search-armavir','Армавир'],['search-krymsk','Крымск']])cityIds[city]=(await owner.query('insert into app.cities(region_id,slug,name) values($1,$2,$3) returning id',[region,slug,city])).rows[0].id;
  const root=(await owner.query("insert into app.categories(slug,name,sort_order) values('search-root','Синтетический раздел',10) returning id")).rows[0].id;
  const child=(await owner.query("insert into app.categories(slug,name,parent_id,sort_order) values('search-child','Синтетический подраздел',$1,20) returning id",[root])).rows[0].id;
  const profession=(await owner.query("insert into app.specialist_categories(slug,name,parent_name) values('search-profession','Синтетический сантехник','Синтетический труд') returning id")).rows[0].id;
  const account=async(profile={name:'Синтетический Мастер',avatarDataUrl:''})=>{
   const id=(await owner.query('insert into app.users(email,password_hash,email_verified_at) values($1,$2,clock_timestamp()) returning id',[
    `search-${randomUUID()}@example.invalid`,'scrypt$131072$8$1$'+'0'.repeat(32)+'$'+'0'.repeat(128)])).rows[0].id;
   if(profile!==null)await owner.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)',[id,JSON.stringify({...profile,phone:'+79990000000',organizationEmail:'private-search-needle@example.invalid',organizationAddress:'PRIVATE_SEARCH_ADDRESS'})]);
   return id;
  };
  const principal=await account(),peer=await account();
  const approve=async(table,id)=>owner.query(`insert into app.${table}(${table==='listing_moderation'?'listing_id':'publication_id'},revision,state,submitted_at,decided_at)
   values($1,1,'approved',clock_timestamp(),clock_timestamp())`,[id]);
  const stamp=async(table,id,published=true)=>owner.query(`update app.${table} set status=$2,is_paid=$3,
   published_at=case when $3 then statement_timestamp()-interval '1 day' end,expires_at=case when $3 then statement_timestamp()+interval '1 day' end where id=$1`,[id,published?'published':'draft',published]);
  const listing=async(patch={})=>{
   const id=(await owner.query(`insert into app.listings(author_id,listing_type,title,description,price,category_id,city_id,contact_phone,messenger_url,address,created_at)
    values($1,'sell',$2,$3,1500,$4,$5,'+79990000000','https://t.me/private_search_needle','PRIVATE_SEARCH_ADDRESS',statement_timestamp()-interval '2 days') returning id`,[
    patch.author??principal,patch.title??'Синтетический стол',patch.description??'Синтетическое описание домашнего стола.',patch.category??child,cityIds[patch.city??'Краснодар']])).rows[0].id;
   await stamp('listings',id,patch.published!==false);if(patch.approved!==false)await approve('listing_moderation',id);return{id,table:'listings',kind:'listing'};
  };
  const common={title:'Синтетическая работа',description:'Подробное синтетическое описание работы для проверки поиска.',cityName:'Краснодар',professionName:'Синтетический сантехник',contactPhone:'+79990000000',placementRightConfirmed:true};
  const work=async(kind='workRequest',patch={})=>{
   const form=parseWorkPublicationForm(kind,{...common,...(kind==='vacancy'?{employerType:'person',organization:'Синтетический Работодатель',salary:'45000',email:'private-search-needle@example.invalid'}:{budget:'1500'}),...patch.form});
   assert.deepEqual(checkWorkPublicationForm(form),[]);
   const id=(await owner.query('insert into app.work_publications(author_id,kind,creation_key,form,city_id,profession_id,created_at) values($1,$2,$3,$4::jsonb,$5,$6,statement_timestamp()-interval \'2 days\') returning id',[
    patch.author??principal,kind,randomUUID(),JSON.stringify(form),cityIds[form.cityName],profession])).rows[0].id;
   await stamp('work_publications',id,patch.published!==false);if(patch.approved!==false)await approve('work_moderation',id);return{id,table:'work_publications',kind,form};
  };
  const serviceCommon=Object.fromEntries(Object.entries(common).filter(([key])=>key!=='professionName'));
  const service=async(kind='specialist',patch={})=>{
   const author=patch.author??(kind==='specialist'?await account():principal);
   const form=parseServicePublicationForm(kind,{...serviceCommon,title:kind==='specialist'?'Синтетический Мастер':'Синтетическая ярмарка',
    ...(kind==='specialist'?{professionName:common.professionName,price:'1500',skills:'Прежние навыки мастера'}:{category:'Посуда',email:'private-search-needle@example.invalid'}),...patch.form});
   assert.deepEqual(checkServicePublicationForm(form),[]);
   const id=(await owner.query('insert into app.service_publications(author_id,kind,creation_key,form,city_id,profession_id,created_at) values($1,$2,$3,$4::jsonb,$5,$6,statement_timestamp()-interval \'2 days\') returning id',[
    author,kind,randomUUID(),JSON.stringify(form),cityIds[form.cityName],kind==='specialist'?profession:null])).rows[0].id;
   await stamp('service_publications',id,patch.published!==false);if(patch.approved!==false)await approve('service_moderation',id);return{id,table:'service_publications',kind,form,author};
  };
  const baseline=[await listing(),await work('vacancy'),await work(),await service(),await service('fair')];
  const href=row=>row.kind==='listing'?'/obyavlenie/'+row.id:row.kind==='vacancy'?'/vakansiya/'+row.id:row.kind==='workRequest'?'/rabota/zakazy/'+row.id:row.kind==='specialist'?'/specialist/'+row.id:'/yarmarka-masterov';
  const find=(result,row)=>result.items.find(item=>item.href===href(row)&&(row.kind!=='fair'||item.title===row.form.title));
  const query=(q,extra={})=>search.search({query:q,page:1,...extra});
  const material=async row=>row.kind==='listing'?normalListing.read(row.id):row.table==='work_publications'?normalWork.read(row.kind,row.id):normalService.read(row.kind,row.id);
  await suite.test('all seven public source types retain priority and expose only SearchResult fields',async()=>{
   const result=await query('СИНТЕТИЧЕСК');assert.deepEqual(result.items.map(item=>item.type),['Объявление','Вакансия','Заказ','Специалист','Ярмарка','Категория','Профессия']);assert.equal(result.hasMore,false);
   for(const row of baseline){assert.ok(await material(row));assert.ok(find(result,row));}
   assert.deepEqual((await query('')).items.map(item=>item.type),result.items.map(item=>item.type));
   for(const item of result.items)assert.ok(Object.keys(item).every(key=>['title','description','href','images','type'].includes(key)));
   for(const value of ['private-search-needle','private_search_needle','PRIVATE_SEARCH_ADDRESS'])assert.equal(JSON.stringify(result).includes(value),false);
  });
  await suite.test('selected city filters publications exactly while taxonomy results remain global',async()=>{
   const local=await listing({title:'Городская метка',city:'Армавир',description:'Описание городской карточки для точного фильтра города.'});
   assert.ok(find(await query('Городская метка',{cityName:'Армавир'}),local));assert.equal(find(await query('Городская метка',{cityName:'Краснодар'}),local),undefined);
   const refs=await query('Синтетическ',{cityName:'Крымск'});assert.deepEqual(refs.items.map(item=>item.type),['Категория','Профессия']);
  });
  await suite.test('private contact/profile fields and unpublished user input are not search predicates',async()=>{
   for(const needle of ['private-search-needle','private_search_needle','PRIVATE_SEARCH_ADDRESS','Прежние навыки мастера'])assert.deepEqual(await query(needle),{items:[],hasMore:false});
   for(const factory of [()=>listing({title:'Приватный черновик',published:false}),()=>work('workRequest',{form:{title:'Приватный черновик'},published:false}),()=>service('fair',{form:{title:'Приватный черновик'},published:false})])await factory();
   assert.deepEqual(await query('Приватный черновик'),{items:[],hasMore:false});
  });
  await suite.test('matching is a case-insensitive literal per-field substring, not regex, SQL or cross-field concatenation',async()=>{
   const literal=await listing({title:'Метка 100% under_score C:\\files !',description:'Простой тест буквальных символов без шаблонов.'});
   for(const needle of ['100%','under_score','C:\\files','!','МЕТКА'])assert.ok(find(await query(needle),literal));
   assert.equal(find(await query('underXscore'),literal),undefined);assert.deepEqual(await query("' OR TRUE --"),{items:[],hasMore:false});
   const separate=await listing({title:'Раздельные слова альфа',description:'бета и последующее содержательное описание.'});assert.equal(find(await query('альфа бета'),separate),undefined);
   const unicode=await listing({title:'İSTANBUL ΟΣ ИНСТРУМЕНТ',description:'Проверка полного Unicode преобразования регистра.'});
   for(const needle of ['i\u0307stanbul','ος','инструмент'])assert.ok(find(await query(needle),unicode));
   assert.equal(find(await query('istanbul'),unicode),undefined);
   assert.equal(find(await query('οσ'),unicode),undefined,'match JS full-lower final sigma rather than extra SQL case folding');
  });
  await suite.test('source ordering and UUID ties stay stable across 24-item pages with a real lookahead',async()=>{
   const rows=[];for(let index=0;index<49;index++)rows.push(await listing({title:'Пагинация каталога '+index}));
   const ids=rows.map(row=>row.id);await owner.query("update app.listings set published_at='2026-01-02T00:00:00.123456Z',created_at='2026-01-01T00:00:00.123456Z',expires_at=clock_timestamp()+interval '1 day' where id=any($1::uuid[])",[ids]);
   const ordered=[...ids].sort().reverse(),pages=[];
   for(const page of [1,2,3])pages.push(await query('Пагинация каталога',{page}));
   assert.deepEqual(pages.map(value=>value.items.length),[24,24,1]);assert.deepEqual(pages.map(value=>value.hasMore),[true,true,false]);
   assert.deepEqual(pages.flatMap(value=>value.items.map(item=>item.href.split('/').at(-1))),ordered);assert.equal(new Set(pages.flatMap(value=>value.items.map(item=>item.href))).size,49);
   assert.deepEqual(await query('Пагинация каталога',{page:1000}),{items:[],hasMore:false});
  });
  await suite.test('reference cursors cross category/profession priority in both directions without losing stable order',async()=>{
   const expected=[];
   for(let index=0;index<27;index++){
    const slug='search-ref-category-'+String(index).padStart(2,'0');
    await owner.query('insert into app.categories(slug,name,sort_order) values($1,$2,$3)',[slug,'Пагинация справочника '+String(index).padStart(2,'0'),index]);expected.push('/katalog/'+slug);
   }
   for(let index=0;index<27;index++){
    const slug='search-ref-profession-'+String(index).padStart(2,'0');
    await owner.query('insert into app.specialist_categories(slug,name,parent_name) values($1,$2,$3)',[slug,'Пагинация справочника '+String(index).padStart(2,'0'),'Справочная группа']);expected.push('/rabota/specialisty/'+slug);
   }
   const pages=[];for(const page of [1,2,3])pages.push(await query('Пагинация справочника',{page}));
   assert.deepEqual(pages.map(result=>result.items.length),[24,24,6]);assert.deepEqual(pages.map(result=>result.hasMore),[true,true,false]);
   assert.deepEqual(pages.flatMap(result=>result.items.map(item=>item.href)),expected);assert.equal(new Set(pages.flatMap(result=>result.items.map(item=>item.href))).size,54);
   assert.equal(typeof pages[0].nextCursor,'string');
   const second=await query('Пагинация справочника',{page:2,cursor:pages[0].nextCursor});assert.deepEqual(second.items,pages[1].items);
   const third=await query('Пагинация справочника',{page:3,cursor:second.nextCursor});assert.deepEqual(third.items,pages[2].items);
   const backSecond=await query('Пагинация справочника',{page:2,cursor:third.previousCursor});assert.deepEqual(backSecond.items,pages[1].items);
   const backFirst=await query('Пагинация справочника',{page:1,cursor:backSecond.previousCursor});assert.deepEqual(backFirst.items,pages[0].items);
  });
  await suite.test('draft, unpaid, expired, blocked author, missing approval and inactive taxonomy match the public stores',async()=>{
   for(const kind of ['listing','vacancy','workRequest','specialist','fair']){
    for(const mode of ['draft','unpaid','expired','blocked','approval']){
     const token=randomBytes(5).toString('hex'),nameToken=token.replace(/[0-9a-f]/g,value=>String.fromCharCode(97+parseInt(value,16)));
     const title='Граница поиска '+token;
     const row=kind==='listing'?await listing({title}):kind==='vacancy'||kind==='workRequest'?await work(kind,{form:{title}}):
      await service(kind,{form:{title},...(kind==='specialist'?{author:await account({name:'Граничный Специалист '+nameToken,avatarDataUrl:''})}:{})});
     try{
      if(mode==='draft')await stamp(row.table,row.id,false);
      else if(mode==='unpaid')await owner.query(`update app.${row.table} set status='archived',is_paid=false where id=$1`,[row.id]);
      else if(mode==='expired')await owner.query(`update app.${row.table} set published_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day' where id=$1`,[row.id]);
      else if(mode==='blocked')await owner.query('update app.users set is_blocked=true where id=(select author_id from app.'+row.table+' where id=$1)',[row.id]);
      else await owner.query(`delete from app.${kind==='listing'?'listing_moderation':row.table==='work_publications'?'work_moderation':'service_moderation'} where ${kind==='listing'?'listing_id':'publication_id'}=$1`,[row.id]);
      assert.equal(await material(row),undefined);
      const result=await query(kind==='specialist'?'Граничный Специалист '+nameToken:title);assert.equal(find(result,row),undefined);
     }finally{
      if(mode==='blocked')await owner.query('update app.users set is_blocked=false where id=(select author_id from app.'+row.table+' where id=$1)',[row.id]);
     }
    }
   }
   await owner.query('update app.specialist_categories set active=false where id=$1',[profession]);
   try{for(const row of baseline.filter(row=>['vacancy','workRequest','specialist'].includes(row.kind))){assert.equal(await material(row),undefined);assert.equal(find(await query('Синтетическ'),row),undefined);}}
   finally{await owner.query('update app.specialist_categories set active=true where id=$1',[profession]);}
  });
  await suite.test('inactive listing root/child, stale review and deleted work/service rows cannot appear through search',async()=>{
   for(const id of [root,child]){
    await owner.query('update app.categories set active=false where id=$1',[id]);
    try{assert.equal(await material(baseline[0]),undefined);assert.equal(find(await query('Синтетический стол'),baseline[0]),undefined);}
    finally{await owner.query('update app.categories set active=true where id=$1',[id]);}
   }
   for(const row of [await listing({title:'Устаревшая проверка'}),await work('vacancy',{form:{title:'Устаревшая проверка'}}),await service('fair',{form:{title:'Устаревшая проверка'}})]){
    await owner.query(`update app.${row.table} set revision=2 where id=$1`,[row.id]);assert.equal(await material(row),undefined);assert.equal(find(await query('Устаревшая проверка'),row),undefined);
   }
   for(const row of [await work('workRequest',{form:{title:'Удалённый материал'}}),await service('fair',{form:{title:'Удалённый материал'}})]){
    await owner.query(`update app.${row.table} set status='archived',deleted_at=clock_timestamp() where id=$1`,[row.id]);assert.equal(await material(row),undefined);assert.equal(find(await query('Удалённый материал'),row),undefined);
   }
  });
  await suite.test('missing, pending and foreign photo sets are hidden with the same outcome as their public readers',async()=>{
   const image=async(author,ready)=>{
    const id=(await owner.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,$2,'image/webp',32,24,100,$3) returning id",[author,randomUUID(),'b'.repeat(64)])).rows[0].id;
    if(ready)await owner.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=$1",[id]);return id;
   };
   for(const kind of ['listing','workRequest','fair'])for(const mode of (kind==='listing'?['pending','foreign']:['missing','pending','foreign'])){
    const title='Фотограница '+kind+' '+mode;
    const row=kind==='listing'?await listing({title}):kind==='workRequest'?await work(kind,{form:{title}}):await service(kind,{form:{title}});
    const author=(await owner.query('select author_id from app.'+row.table+' where id=$1',[row.id])).rows[0].author_id;
    const media=await image(mode==='foreign'?peer:author,mode!=='pending');
    if(kind!=='listing')await owner.query('update app.'+row.table+" set form=jsonb_set(form,'{photoIds}',$2::jsonb) where id=$1",[row.id,JSON.stringify([media])]);
    if(mode!=='missing'||kind==='listing')await owner.query(`insert into app.${kind==='listing'?'listing_photos':kind==='workRequest'?'work_publication_photos':'service_publication_photos'}(${kind==='listing'?'listing_id':'publication_id'},media_id,position) values($1,$2,0)`,[row.id,media]);
    assert.equal(await material(row),undefined);assert.equal(find(await query(title),row),undefined);
   }
  });
  await suite.test('malformed published DTOs do not cause query-specific errors, expose hidden contents or truncate valid refill results',async()=>{
   const bad=[];for(let index=0;index<28;index++)bad.push(await listing({title:'я',description:'Проверка заполнения испорченных результатов.'}));
   const good=[];for(let index=0;index<30;index++)good.push(await listing({title:'Заполнение результатов '+index,description:'Проверка заполнения испорченных результатов.'}));
   await owner.query("update app.listings set published_at=clock_timestamp()-interval '1 hour' where id=any($1::uuid[])",[bad.map(row=>row.id)]);
   for(const row of bad)assert.equal(await material(row),undefined);
   const result=await query('Проверка заполнения испорченных');assert.equal(result.items.length,24);assert.equal(result.hasMore,true);
   assert.ok(result.items.every(item=>good.some(row=>href(row)===item.href)));
   const numericSecond=await query('Проверка заполнения испорченных',{page:2});assert.equal(numericSecond.items.length,6);assert.equal(numericSecond.hasMore,false);
   assert.equal(new Set([...result.items,...numericSecond.items].map(item=>item.href)).size,30,'an invalid prefix must not duplicate or omit valid page2 results');
   assert.equal(typeof result.nextCursor,'string');assert.equal(result.previousCursor,undefined);
   const cursorSecond=await query('Проверка заполнения испорченных',{page:2,cursor:result.nextCursor});assert.deepEqual(cursorSecond.items,numericSecond.items);assert.equal(cursorSecond.hasMore,false);
   assert.equal(typeof cursorSecond.previousCursor,'string');
   const previous=await query('Проверка заполнения испорченных',{page:1,cursor:cursorSecond.previousCursor});assert.deepEqual(previous.items,result.items);
   await assert.rejects(query('Другое условие',{page:2,cursor:result.nextCursor}));
   await assert.rejects(query('Проверка заполнения испорченных',{page:2,cityName:'Армавир',cursor:result.nextCursor}));
   const onlyBad=await listing({title:'я',description:'Единственная недопустимая карточка.'});assert.equal(await material(onlyBad),undefined);assert.deepEqual(await query('Единственная недопустимая'),{items:[],hasMore:false});
   const badIdentity=await service('specialist',{author:await account({name:'Скрытый Специалист',avatarDataUrl:'invalid-avatar'}),form:{title:'Скрытый Специалист'}});
   assert.equal(await material(badIdentity),undefined);assert.deepEqual(await query('Скрытый Специалист'),{items:[],hasMore:false});
   const absentIdentity=await service('specialist',{author:await account(null),form:{title:'Скрытое имя формы'}});
   assert.equal(await material(absentIdentity),undefined);assert.deepEqual(await query('Скрытое имя формы'),{items:[],hasMore:false});
  });
  await suite.test('current profile, profession and category names are searched without rewriting publication snapshots',async()=>{
   const specialist=baseline.find(row=>row.kind==='specialist'),row=await listing({title:'Карточка актуального раздела'});
   const before=(await owner.query('select form,revision::text,updated_at::text,is_paid,published_at::text,expires_at::text from app.service_publications where id=$1',[specialist.id])).rows[0];
   await owner.query("update app.cabinet_profiles set profile=jsonb_set(profile,'{name}',to_jsonb('Переименованный Мастер'::text)) where user_id=$1",[specialist.author]);
   await owner.query("update app.specialist_categories set name='Переименованная профессия' where id=$1",[profession]);
   await owner.query("update app.categories set name='Переименованный раздел' where id=$1",[root]);
   assert.ok(find(await query('Переименованный Мастер'),specialist));assert.ok(find(await query('Переименованная профессия'),specialist));
   assert.ok(find(await query('Переименованный раздел'),row));assert.match(find(await query('Переименованный раздел'),row).description,/Переименованный раздел/);
   assert.equal(find(await query('Синтетический Мастер'),specialist),undefined);assert.equal(find(await query('Синтетический сантехник'),specialist),undefined);assert.equal(find(await query('Синтетический раздел'),row),undefined);
   assert.deepEqual((await owner.query('select form,revision::text,updated_at::text,is_paid,published_at::text,expires_at::text from app.service_publications where id=$1',[specialist.id])).rows[0],before);
  });
  await suite.test('all search traffic remains read-only and SQL-looking arguments cannot change database state',async()=>{
   await assert.rejects(runtime.query('update app.specialist_categories set active=false'),{code:'42501'});
   await assert.rejects(runtime.query('update app.listings set is_paid=true'),{code:'42501'});
   const before=(await owner.query('select count(*)::int as n from app.listings')).rows[0].n;await query("'; delete from app.listings; --");
   assert.equal((await owner.query('select count(*)::int as n from app.listings')).rows[0].n,before);
  });
  await suite.test('invalid arguments fail without changing rows or broadening the search',async()=>{
   for(const input of [{query:1,page:1},{query:'x'.repeat(201),page:1},{query:'x',page:0},{query:'x',page:1001},{query:'x',page:1.5},
    {query:'x',page:1,cityName:{}},{query:'x',page:1,ownerId:principal},{query:'bad\u0000query',page:1}])await assert.rejects(search.search(input));
  });
  await suite.test('candidate and hydration reads share one snapshot across concurrent profile rename',async()=>{
   const row=await service('specialist',{author:await account({name:'Согласованный Мастер',avatarDataUrl:''}),form:{title:'Согласованный Мастер'}});let mutations=0;
   const changing={readTransaction:(work,options)=>runtime.readTransaction(tx=>work({query:async(sql,args)=>{
    const result=await tx.query(sql,args);
    if(!mutations&&sql.toLowerCase().includes('union all')){mutations++;
     await owner.query("update app.cabinet_profiles set profile=jsonb_set(profile,'{name}',to_jsonb('Последующий Мастер'::text)) where user_id=$1",[row.author]);
    }return result;
   }}),options)};
   const result=await new PostgresPublicSearchStore(changing,{specialistProfileIdentity:true}).search({query:'Согласованный Мастер',page:1});
   assert.equal(mutations,1);assert.match(find(result,row).title,/Согласованный Мастер/);assert.equal(find(await query('Согласованный Мастер'),row),undefined);assert.ok(find(await query('Последующий Мастер'),row));
  });
  await suite.test('real read scope is repeatable/read-only and its deadline terminates SQL without poisoning the next checkout',async()=>{
   let completed=0;
   const settings=await runtime.readTransaction(async tx=>(await tx.query("select current_setting('transaction_read_only') as readonly,current_setting('transaction_isolation') as isolation")).rows[0],{timeoutMs:1000,onComplete:()=>completed++});
   assert.deepEqual(settings,{readonly:'on',isolation:'repeatable read'});assert.equal(completed,1);
   const started=performance.now();await assert.rejects(runtime.readTransaction(tx=>tx.query('select pg_sleep(1)'),{timeoutMs:100}),error=>['ETIMEDOUT','57014','25P04'].includes(error.code));assert.ok(performance.now()-started<1500);
   for(const deadline=Date.now()+1500;;){const active=(await owner.query("select count(*)::int as n from pg_stat_activity where usename='search_runtime' and state='active' and query like '%pg_sleep%' ")).rows[0].n;if(!active)break;assert.ok(Date.now()<deadline,'expired SQL must not keep running');await new Promise(resolve=>setTimeout(resolve,20));}
   assert.equal((await runtime.query('select 42 as answer')).rows[0].answer,42);
   const trusted=new PostgresDatabase(new pg.Pool({...config,max:1}));
   try{await assert.rejects(trusted.readTransaction(tx=>tx.query("insert into app.regions(slug,name) values('forbidden-read-write','Запрещённая запись')"),{timeoutMs:1000}),{code:'25006'});}
   finally{await trusted.close();}
  });
  await suite.test('an inherited absolute deadline bounds real SQL and expired reads leave the next checkout healthy',async()=>{
   let completed=0;const started=performance.now();
   await assert.rejects(runtime.readTransaction(tx=>tx.query('select pg_sleep(1)'),{
    timeoutMs:1000,deadline:started+100,onComplete:()=>completed++,
   }),error=>['ETIMEDOUT','57014','25P04'].includes(error.code));
   assert.ok(performance.now()-started<700);assert.equal(completed,1);
   await assert.rejects(runtime.readTransaction(()=>assert.fail('expired read must not run SQL'),{
    timeoutMs:1000,deadline:performance.now()-1,onComplete:()=>completed++,
   }),{code:'ETIMEDOUT'});
   assert.equal(completed,2);assert.equal((await runtime.query('select 42 as answer')).rows[0].answer,42);
  });
  await suite.test('cursor windows cross vacancy/order and specialist/fair mixed branches in both directions',async()=>{
   const groups=[{query:'Граница смешанной работы',kinds:['vacancy','workRequest'],types:['Вакансия','Заказ']},
    {query:'Граница смешанной услуги',kinds:['specialist','fair'],types:['Специалист','Ярмарка']}];
   for(const group of groups){
    for(const kind of group.kinds)for(let index=0;index<27;index++){
     if(kind==='specialist'){
      const letters=String.fromCharCode(1072+Math.floor(index/26),1072+index%26);
      await service(kind,{author:await account({name:group.query+' Мастер '+letters,avatarDataUrl:''}),form:{title:group.query+' Мастер '+letters}});
     }else if(kind==='fair')await service(kind,{form:{title:group.query+' ярмарка '+index}});
     else await work(kind,{form:{title:group.query+' '+kind+' '+index}});
    }
    const first=await query(group.query),second=await query(group.query,{page:2,cursor:first.nextCursor}),third=await query(group.query,{page:3,cursor:second.nextCursor});
    assert.deepEqual(first.items.map(item=>item.type),Array(24).fill(group.types[0]));
    assert.deepEqual(second.items.map(item=>item.type),[...Array(3).fill(group.types[0]),...Array(21).fill(group.types[1])]);
    assert.deepEqual(third.items.map(item=>item.type),Array(6).fill(group.types[1]));
    assert.equal(first.hasMore,true);assert.equal(second.hasMore,true);assert.equal(third.hasMore,false);
    const all=[...first.items,...second.items,...third.items];assert.equal(new Set(all.map(item=>item.title)).size,54);
    const backSecond=await query(group.query,{page:2,cursor:third.previousCursor});assert.deepEqual(backSecond.items,second.items);
    const backFirst=await query(group.query,{page:1,cursor:backSecond.previousCursor});assert.deepEqual(backFirst.items,first.items);
    assert.equal(backFirst.previousCursor,undefined);
   }
  });
  await suite.test('postmoderation searches retain listing blocks and selected-order closure while baseline policy stays separate',async()=>{
   Object.assign(process.env,{BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai'});delete process.env.BLIZHNIY_LOCAL_PRIMARY;
   const post=new PostgresPublicSearchStore(runtime,{postmoderation:true,specialistProfileIdentity:true});
   const blocked=await listing({title:'Заблокированная карточка'}),closed=await work('workRequest',{form:{title:'Закрытый заказ'}});
   await owner.query("insert into app.listing_blocks(listing_id,blocked_by,blocked_revision,reason) values($1,$2,1,'Синтетическая причина')",[blocked.id,principal]);
   // One statement clock prevents sent_at from preceding the later-evaluated created_at default.
   await owner.query(`insert into app.applications(applicant_id,work_publication_id,creation_key,target_revision,specialist_revision,snapshot,status,is_paid,created_at,sent_at)
    values($1,$2,$3,1,1,'{}'::jsonb,'selected',true,statement_timestamp(),statement_timestamp())`,[peer,closed.id,randomUUID()]);
   assert.ok(find(await query('Заблокированная карточка'),blocked));assert.ok(find(await query('Закрытый заказ'),closed));
   assert.equal(find(await post.search({query:'Заблокированная карточка',page:1}),blocked),undefined);
   assert.equal(find(await post.search({query:'Закрытый заказ',page:1}),closed),undefined);
  });
  if(benchmark)await suite.test('measured synthetic 25000-publication search: missing, popular and deep; actual EXPLAIN and two-reader concurrency',{timeout:300000},async()=>{
   // This database is the exclusively owned tmpfs fixture, not the shared/manual stand.
   // Clear earlier corruption/gate cases before comparing healthy-catalog algorithms.
   await owner.query('truncate app.listings,app.work_publications,app.service_publications cascade');
   const total=5000,benchKey=randomBytes(5).toString('hex'),benchStarted=performance.now();
   const stage=(phase,extra={})=>console.log(JSON.stringify({searchBenchmark:phase,elapsedMs:Math.round(performance.now()-benchStarted),...extra}));stage('seed-start');
   await owner.query(`insert into app.listings(author_id,listing_type,title,description,price,category_id,city_id,contact_phone,status,is_paid,created_at,published_at,expires_at)
    select $1,'sell','Бенч популярный стол '||i,'Синтетическое описание опубликованного стола для сравнения поиска.',1500,$2,$3,'+79990000000','published',true,
     statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day',statement_timestamp()+interval '1 day' from generate_series(1,$4) i`,[principal,child,cityIds['Краснодар'],total]);
   stage('listings-seeded');
   for(const kind of ['vacancy','workRequest']){
    const template=parseWorkPublicationForm(kind,{...common,...(kind==='vacancy'?{employerType:'person',organization:'Синтетический Работодатель',salary:'45000'}:{budget:'1500'})});
    await owner.query(`insert into app.work_publications(author_id,kind,creation_key,form,city_id,profession_id,status,is_paid,created_at,published_at,expires_at)
     select $1,$2,gen_random_uuid(),jsonb_set($3::jsonb,'{title}',to_jsonb($4::text||i)),$5,$6,'published',true,
      statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day',statement_timestamp()+interval '1 day' from generate_series(1,$7) i`,
     [principal,kind,JSON.stringify(template),kind==='vacancy'?'Бенч популярная вакансия ':'Бенч популярный заказ ',cityIds['Краснодар'],profession,total]);
   }
   stage('work-seeded');
   const emailPrefix='searchbench-'+benchKey+'-';
   await owner.query(`insert into app.users(email,password_hash,email_verified_at)
    select $1||i||'@example.invalid',$2,clock_timestamp() from generate_series(1,$3) i`,[emailPrefix,'scrypt$131072$8$1$'+'0'.repeat(32)+'$'+'0'.repeat(128),total]);
   await owner.query(`insert into app.cabinet_profiles(user_id,profile)
    select id,jsonb_build_object('name','Бенч Популярный Мастер '||translate(split_part(split_part(email,'@',1),'-',3),'0123456789','abcdefghij'),'avatarDataUrl','')
    from app.users where email like $1`,[emailPrefix+'%']);
   stage('specialist-profiles-seeded');
   const specialistTemplate=parseServicePublicationForm('specialist',{...common,title:'Бенч специалист',price:'1500',skills:'Синтетические навыки мастера'});
   await owner.query(`insert into app.service_publications(author_id,kind,creation_key,form,city_id,profession_id,status,is_paid,created_at,published_at,expires_at)
    select id,'specialist',gen_random_uuid(),$1::jsonb,$2,$3,'published',true,statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day',statement_timestamp()+interval '1 day'
    from app.users where email like $4`,[JSON.stringify(specialistTemplate),cityIds['Краснодар'],profession,emailPrefix+'%']);
   const fairTemplate=parseServicePublicationForm('fair',{...serviceCommon,title:'Бенч популярная ярмарка',category:'Посуда',email:'synthetic@example.invalid'});
   await owner.query(`insert into app.service_publications(author_id,kind,creation_key,form,city_id,status,is_paid,created_at,published_at,expires_at)
    select $1,'fair',gen_random_uuid(),jsonb_set($2::jsonb,'{title}',to_jsonb('Бенч популярная ярмарка '||i)),$3,'published',true,
     statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day',statement_timestamp()+interval '1 day' from generate_series(1,$4) i`,[principal,JSON.stringify(fairTemplate),cityIds['Краснодар'],total]);
   for(const [table,column,source]of[['listing_moderation','listing_id','listings'],['work_moderation','publication_id','work_publications'],['service_moderation','publication_id','service_publications']])
    await owner.query(`insert into app.${table}(${column},revision,state,submitted_at,decided_at) select id,revision,'approved',clock_timestamp(),clock_timestamp() from app.${source}`);
   await owner.query('analyze');stage('seed-complete');
   assert.deepEqual((await owner.query('select (select count(*)::int from app.listings) as listings,(select count(*)::int from app.work_publications) as work,(select count(*)::int from app.service_publications) as services')).rows[0],{listings:5000,work:10000,services:10000});
   const referenceKinds=['Объявление','Вакансия','Заказ','Специалист','Ярмарка'];
   const legacy=async(input)=>{
    let skipped=0,rowsRead=0,reads=0;const items=[],needle=input.query.toLowerCase().trim(),offset=(input.page-1)*24;
    const fields=[row=>[row.title,row.description,row.city,row.subcategory,row.kind],row=>[row.title,row.organization,row.profession,row.city,row.description],
     row=>[row.title,row.description,row.author,row.profession,row.city],row=>[row.name,row.profession,row.skills,row.city],row=>[row.participantName,row.category,row.description,row.city]];
    const readers=[(limit,offset)=>normalListing.list({limit,offset}),(limit,offset)=>normalWork.list('vacancy',limit,offset),(limit,offset)=>normalWork.list('workRequest',limit,offset),
     (limit,offset)=>normalService.list('specialist',limit,offset),(limit,offset)=>normalService.list('fair',limit,offset)];
    for(let kind=0;kind<readers.length&&items.length<25;kind++)for(let at=0;items.length<25;at+=100){
     const rows=await readers[kind](100,at);reads++;rowsRead+=rows.length;
     for(const row of rows)if((!input.cityName||row.city===input.cityName)&&fields[kind](row).some(value=>(value??'').toLowerCase().trim().includes(needle))){
      if(skipped++>=offset)items.push({type:referenceKinds[kind],id:row.id,...(kind===4?{title:row.participantName}:{})});if(items.length>=25)break;
     }
     if(rows.length<100)break;
    }
    return{items:items.slice(0,24),hasMore:items.length>24,reads,rowsRead};
   };
   const deepQuery='Бенч популяр';
   const anchor=(await owner.query(`select id,5 as rank,to_char(published_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "publishedAt",
    to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",0 as "sortOrder",''::text as parent,''::text as name
    from app.service_publications where kind='fair' order by published_at desc,created_at desc,id desc offset 3975 limit 1`)).rows[0];
   assert.ok(await normalService.read('fair',anchor.id),'deep cursor anchor must itself be an eligible public row');
   const deepCursor=load('public-search-cursor').encodePublicSearchCursor(anchor,{query:deepQuery,page:1000},'next');
   const cases=[{name:'popular',query:deepQuery,page:1},{name:'missing',query:'Бенчневозможнаяфраза',page:1},{name:'deep',query:deepQuery,page:1000,cursor:deepCursor}];
   const modernInput=item=>({query:item.query,page:item.page,...(item.cursor?{cursor:item.cursor}:{})});
   const p95=values=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1],reports=[];
   for(const item of cases){
    let trace=[];
    const measured={readTransaction:(work,options)=>runtime.readTransaction(tx=>work({query:async(text,values)=>{
     const result=await tx.query(text,values);trace.push({text,values,rows:result.rows.length});return result;
    }}),options)};
    const modern=new PostgresPublicSearchStore(measured,{specialistProfileIdentity:true});
    stage('case-warmup',{case:item.name});await legacy(item);stage('legacy-warmup-complete',{case:item.name});await modern.search(modernInput(item));stage('modern-warmup-complete',{case:item.name});
    const oldTimes=[],newTimes=[];let oldResult,newResult,lastTrace;
    for(let attempt=0;attempt<20;attempt++){
     if(attempt<3){const first=performance.now();oldResult=await legacy(item);oldTimes.push(performance.now()-first);}trace=[];
     const next=performance.now();newResult=await modern.search(modernInput(item));newTimes.push(performance.now()-next);lastTrace=trace;stage('sample-complete',{case:item.name,sample:attempt+1,...(attempt<3?{legacyMs:Math.round(oldTimes.at(-1))}:{}),modernMs:Math.round(newTimes.at(-1))});
     assert.equal(newResult.items.length,oldResult.items.length);assert.equal(newResult.hasMore,oldResult.hasMore);
     assert.deepEqual(newResult.items.map(row=>row.type),oldResult.items.map(row=>row.type));
     for(let index=0;index<newResult.items.length;index++)if(newResult.items[index].type!=='Ярмарка')assert.ok(newResult.items[index].href.endsWith(oldResult.items[index].id));else assert.equal(newResult.items[index].title,oldResult.items[index].title);
    }
    const candidate=lastTrace.find(row=>row.text.toLowerCase().includes('union all'));assert.ok(candidate,'measure the actual search candidate SQL');
    const explain=(await runtime.query('explain(analyze,buffers,format json) '+candidate.text,candidate.values)).rows[0]['QUERY PLAN'][0];
    const planNodes=[];const walk=node=>{planNodes.push({type:node['Node Type'],rows:node['Actual Rows'],loops:node['Actual Loops'],removed:node['Rows Removed by Filter']??0});for(const child of node.Plans??[])walk(child);};walk(explain.Plan);
    const report={case:item.name,publications:25000,legacyScope:'five publication readers; references do not match benchmark needles',legacy:{method:'numeric-page',samples:oldTimes.length,medianMs:[...oldTimes].sort((a,b)=>a-b)[1],rangeMs:[Math.min(...oldTimes),Math.max(...oldTimes)],reads:oldResult.reads,rowsTransferred:oldResult.rowsRead},
     modern:{method:item.cursor?'public-cursor':'first-page',samples:newTimes.length,p95ms:p95(newTimes),reads:lastTrace.length,rowsTransferred:lastTrace.reduce((sum,row)=>sum+row.rows,0)},
     explain:{planningMs:explain['Planning Time'],executionMs:explain['Execution Time'],sharedHits:explain.Plan['Shared Hit Blocks'],sharedReads:explain.Plan['Shared Read Blocks'],nodes:planNodes}};
    report.sqlSha256=createHash('sha256').update(candidate.text).digest('hex');reports.push(report);stage('case-result',report);suite.diagnostic(JSON.stringify(report));
   }
   const start=performance.now(),parallel=await Promise.all(cases.filter(item=>item.name!=='popular').map(item=>search.search(modernInput(item))));
   assert.equal(parallel[0].items.length,0);assert.equal(parallel[1].items.length,24);
   const result={version:1,rows:25000,legacySamplesPerCase:3,modernSamplesPerCase:20,parallelReaders:2,parallelMs:performance.now()-start,cases:reports};
   const reportPath=join(await mkdtemp(join(tmpdir(),'blizhniy-search-report-')),'blizhniy-f12-search-benchmark.json');
   await writeFile(reportPath,JSON.stringify(result,null,2),{flag:'wx',mode:0o600});
   suite.diagnostic('Search benchmark report: '+reportPath);
   assert.ok(reports.find(row=>row.case==='missing').modern.rowsTransferred<100);
   assert.ok(reports.find(row=>row.case==='deep').modern.rowsTransferred<=50);
  });
 }finally{
  for(const key of keys){if(beforeEnv[key]===undefined)delete process.env[key];else process.env[key]=beforeEnv[key];}
  await runtime?.close();await owner?.end();
  if(containerId){const metadata=JSON.parse(await docker(['inspect',containerId]))[0];assert.equal(metadata.Id,containerId);assert.equal(metadata.Name,'/'+name);assert.equal(metadata.Config.Labels[label],name);await docker(['rm','--force',containerId]);}
 }
}

test('primary public search: actual SQL preserves all public gates, text semantics and bounded pages',{timeout:90000},suite=>runSearchFixture(suite));
if(process.env.BLIZHNIY_SEARCH_BENCHMARK==='1')test('opt-in search performance experiment on exclusively owned synthetic PG18',{timeout:300000},suite=>runSearchFixture(suite,true));
