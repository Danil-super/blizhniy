const assert=require('node:assert/strict'),test=require('node:test');
const {loadLocalPrimaryModule:load}=require('../scripts/local-primary-modules.cjs');
const {PostgresServicePublicationStore}=load('postgres-service-publications');
const {mapPublicServicePublication}=load('public-service-publications');
const {parseServicePublicationForm}=load('service-publication-contract');
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
function fixture(){
 let stored;const calls=[];
 const db={transaction:work=>work({query:async(sql,args=[])=>{
  calls.push([sql,args]);
  if(sql.startsWith('select u.id'))return{rows:[{id:owner,verified:true,isBlocked:false,role:'user',authVersion:'0'}],rowCount:1};
  if(sql.includes('from app.cabinet_profiles'))return{rows:[{name:'Анна-Мария'}],rowCount:1};
  if(sql.startsWith('insert into app.service_publications')){stored=JSON.parse(args[3]);return{rows:[{id}],rowCount:1};}
  if(sql.startsWith('select id,kind,form'))return{rows:[{id,kind:'specialist',form:stored,revision:'1',status:'draft',paid:false}],rowCount:1};
  if(sql.startsWith(`select id,kind,case when kind in ('vacancy','workRequest','specialist') and profession_id is not null
  then form || jsonb_build_object('professionName',(select profession_name.name from app.specialist_categories profession_name where profession_name.id=profession_id))
  else form end as form,profession_id as "professionId",revision::text as revision,`))return{rows:[{id,kind:'specialist',form:stored,revision:'1',status:'draft',paid:false}],rowCount:1};
  return{rows:[],rowCount:1};
 }})};
 return{store:new PostgresServicePublicationStore(db,{specialistProfileIdentity:true}),calls,get form(){return stored;}};
}
test('real service write derives specialist identity from authenticated profile and clears obsolete separate media/location fields',async()=>{
 const f=fixture();
 await f.store.create('a'.repeat(64),owner,'specialist',id,{title:'Подменённое имя',district:'Старый район',videoUrl:'https://example.invalid/video',photoIds:['33333333-3333-4333-8333-333333333333']});
 assert.equal(f.form.title,'Анна-Мария');assert.equal(f.form.district,null);assert.equal(f.form.videoUrl,null);assert.deepEqual(f.form.photoIds,[]);
 const identity=f.calls.find(([sql])=>sql.includes('from app.cabinet_profiles'));
 assert.deepEqual(identity[1],[owner]);
 assert.ok(!identity[0].includes(owner),'owner must remain a SQL parameter');
});
test('profile-bound specialist refuses save if profile cannot be loaded, never falls back to client name',async()=>{
 let inserts=0;const db={transaction:work=>work({query:async sql=>{
  if(sql.startsWith('select u.id'))return{rows:[{id:owner,verified:true,isBlocked:false,role:'user',authVersion:'0'}],rowCount:1};
  if(sql.startsWith('insert'))inserts++;
  return{rows:[],rowCount:1};
 }})};
 await assert.rejects(new PostgresServicePublicationStore(db,{specialistProfileIdentity:true}).create('a'.repeat(64),owner,'specialist',id,{title:'Клиент'}));
 assert.equal(inserts,0);
});
test('profile-bound write preserves former description, skills and experience in the single about field',async()=>{
 const f=fixture();
 await f.store.create('a'.repeat(64),owner,'specialist',id,{description:'Работаю аккуратно.',skills:'Монтаж труб',experience:'5 лет'});
 assert.equal(f.form.description,'Работаю аккуратно.\n\nНавыки: Монтаж труб\n\nОпыт и квалификация: 5 лет');
 assert.equal(f.form.skills,null);assert.equal(f.form.experience,null);
});
test('single-about profile keeps paid catalogue eligibility without legacy skills, never without payment or within an expired window',()=>{
 const now=Date.parse('2026-10-25T12:00:00Z');
 const row={id,kind:'specialist',form:parseServicePublicationForm('specialist',{title:'Анна',description:'Выполняю монтаж и ремонт сантехники.',cityName:'Краснодар',professionName:'Сантехник',price:'1500',contactPhone:'+79990000000',placementRightConfirmed:true}),mediaIds:[],status:'published',paid:true,createdAt:'2026-10-01T00:00:00Z',publishedAt:'2026-10-01T00:00:00Z',expiresAt:'2027-01-01T00:00:00Z',profileIdentity:{name:'Анна-Мария',avatarDataUrl:png}};
 const dto=mapPublicServicePublication(row,now);
 assert.ok(dto);assert.equal(dto.description,row.form.description);assert.equal(dto.skills,'');
 for(const patch of [{paid:false},{status:'draft'},{expiresAt:'2026-10-24T00:00:00Z'}])assert.equal(mapPublicServicePublication({...row,...patch},now),null);
 const legacy={...row,form:{...row.form,description:'А'.repeat(3000),skills:'Б'.repeat(500),experience:'В'.repeat(500)}};
 assert.ok(mapPublicServicePublication(legacy,now),'Already published legacy text is preserved until the owner edits it');
});
test('public specialist uses only allowlisted current profile identity/avatar, not old portfolio photos or private profile data',()=>{
 const now=Date.parse('2026-10-25T12:00:00Z'),form=parseServicePublicationForm('specialist',{title:'Прежнее имя',description:'Подробное описание специалиста.',cityName:'Краснодар',professionName:'Сантехник',price:'1500',skills:'Ремонт',contactPhone:'+79990000000',placementRightConfirmed:true});
 const row={id,kind:'specialist',form,mediaIds:[],status:'published',paid:true,createdAt:'2026-10-01T00:00:00Z',publishedAt:'2026-10-01T00:00:00Z',expiresAt:'2027-01-01T00:00:00Z',profileIdentity:{name:'Анна-Мария',avatarDataUrl:png,email:'private@example.invalid',phone:'PRIVATE'}};
 row.form={...row.form,district:'Прежний район',videoUrl:'https://example.invalid/video'};
 const dto=mapPublicServicePublication(row,now);
 assert.equal(dto.name,'Анна-Мария');assert.deepEqual(dto.images,[png]);assert.doesNotMatch(JSON.stringify(dto),/PRIVATE|private@example/);
 assert.equal(Object.hasOwn(dto,'district'),false);assert.equal(Object.hasOwn(dto,'videoUrl'),false);
 row.profileIdentity={name:'Анна-Мария',avatarDataUrl:''};assert.deepEqual(mapPublicServicePublication(row,now).images,[]);
 row.profileIdentity={name:'Анна-Мария',avatarDataUrl:'data:image/svg+xml;base64,PHN2Zz4='};assert.equal(mapPublicServicePublication(row,now),null);
});
