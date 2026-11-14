// Only the caller's disposable PG fixture; no installed schema, files or payments.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function insertMediaPayment(db,owner,type,target,revision='1',id=randomUUID()){
 const body=JSON.stringify({amount:{value:'199.00',currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://example.invalid/payment'},metadata:{localPaymentId:id,targetId:target,targetType:type,tariffId:'fixture-publication'}});
 await db.query(`insert into app.payment_checkout_intents(id,owner_id,target_type,target_id,target_revision,tariff_id,amount,duration_days,merchant_shop_id,is_test,request_body)
  values($1,$2,$3,$4,$5,'fixture-publication',199,30,'local-fixture-shop',true,$6) on conflict(id) do nothing`,[id,owner,type,target,revision,body]);return id;
}
export async function testMediaRetirementCandidate(suite,{admin,holder,waiter,owner,ids,legacyIntent}){
 const clockDefinition=(await admin.query("select pg_get_functiondef('app.media_retention_clock()'::regprocedure) ddl")).rows[0].ddl;
 const base=new Date((await admin.query('select app.media_retention_clock() stamp')).rows[0].stamp).getTime();
 const clock=async offset=>{const stamp=new Date(base+offset).toISOString();assert.match(stamp,/^[0-9TZ:.-]+$/);await admin.query(`create or replace function app.media_retention_clock() returns timestamptz language sql volatile set search_path=pg_catalog,pg_temp as $$select timestamptz '${stamp}'$$`);};
 const day=86400000;
 const media=async()=>{const id=(await admin.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,$2,'image/webp',16,9,128,$3) returning id",[owner,randomUUID(),'c'.repeat(64)])).rows[0].id;await admin.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=$1",[id]);return id;};
 const events=async intent=>(await admin.query("select media_id from app.media_reference_events where source='payment_checkout_intents' and resource_id=$1 and event_type='history' order by media_id",[intent])).rows.map(row=>row.media_id);
 const listing=async()=> (await admin.query("insert into app.listings(author_id,listing_type,title) values($1,'sell','Карточка для хранения фото') returning id",[owner])).rows[0].id;
 const request=async(db,id,operation=randomUUID())=>{await db.query('insert into app.media_retirement_requests(media_id,operation_id) values($1,$2) on conflict(media_id) do nothing',[id,operation]);return operation;};
 const usage=async()=>({budget:(await admin.query('select charged_bytes::text,charged_objects from app.media_storage_budget')).rows[0],owner:(await admin.query('select charged_bytes::text,charged_objects from app.media_active_usage where owner_id=$1',[owner])).rows[0]});
 try{
  await suite.test('legacy payment captures conservatively retain preexisting photos, without copying financial payloads',async()=>{
   assert.equal((await admin.query('select capture_type from app.media_payment_reference_captures where intent_id=$1',[legacyIntent])).rows[0].capture_type,'legacy');
   assert.deepEqual(await events(legacyIntent),[...ids].sort());
   await clock(10*day);for(const id of ids)await assert.rejects(request(admin,id),error=>error.code==='MRJ02');
   assert.equal(JSON.stringify((await admin.query('select * from app.media_payment_reference_captures')).rows).includes('return_url'),false);
  });
  await suite.test('new checkout captures exact original photos; skipped inserts and target edits cannot rewrite history',async()=>{
   await clock(0);const oldPhoto=await media(),replacement=await media(),target=await listing();
   await admin.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)',[target,oldPhoto]);
   const intent=await insertMediaPayment(admin,owner,'listing',target);
   assert.equal((await admin.query('select capture_type from app.media_payment_reference_captures where intent_id=$1',[intent])).rows[0].capture_type,'exact');assert.deepEqual(await events(intent),[oldPhoto]);
   await admin.query('delete from app.listing_photos where listing_id=$1',[target]);await admin.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)',[target,replacement]);
   await insertMediaPayment(admin,owner,'listing',target,'1',intent);assert.deepEqual(await events(intent),[oldPhoto]);
   await clock(10*day);await assert.rejects(request(admin,oldPhoto),error=>error.code==='MRJ02');
  });
  await suite.test('zero-photo checkout is distinguished from an unresolved revision',async()=>{
   await clock(0);const target=await listing(),exact=await insertMediaPayment(admin,owner,'listing',target);
   assert.equal((await admin.query('select capture_type from app.media_payment_reference_captures where intent_id=$1',[exact])).rows[0].capture_type,'exact');assert.deepEqual(await events(exact),[]);
   const all=(await admin.query('select id from app.media_objects order by id')).rows.map(row=>row.id),unknown=await insertMediaPayment(admin,owner,'listing',target,'99');
   assert.equal((await admin.query('select capture_type from app.media_payment_reference_captures where intent_id=$1',[unknown])).rows[0].capture_type,'unresolved');assert.deepEqual(await events(unknown),all);
  });
  await suite.test('the capture limit counts distinct existing photos, not repeated JSON observations',async()=>{
   await clock(0);await holder.query('begin');
   try{
    await holder.query("set local statement_timeout='20s'");
    await holder.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) select $1,gen_random_uuid(),'image/webp',16,9,128,repeat('f',64) from generate_series(1,10000-(select count(*)::int from app.media_objects))",[owner]);
    await holder.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where state='pending'");
    const photo=(await holder.query('select id from app.media_objects order by id limit 1')).rows[0].id;
    const target=(await holder.query("insert into app.listings(author_id,listing_type,title,booking) values($1,'sell','Граница старого набора',$2) returning id",[owner,{photoIds:[photo]}])).rows[0].id;
    await holder.query('insert into app.listing_photos(listing_id,media_id,position) select $1,id,(row_number() over(order by id)-1)::integer from app.media_objects',[target]);
    const intent=await insertMediaPayment(holder,owner,'listing',target);
    assert.equal((await holder.query("select count(*)::int n from app.media_reference_events where source='payment_checkout_intents' and resource_id=$1 and event_type='history'",[intent])).rows[0].n,10000);
   }finally{await holder.query('rollback');}
  });
  await suite.test('work and service checkout snapshots survive photo and form removal',async()=>{
   await clock(0);
   for(const[kind,type,table,photos]of [['vacancy','vacancy','work_publications','work_publication_photos'],['fair','fair_application','service_publications','service_publication_photos']]){
    const photo=await media(),target=(await admin.query(`insert into app.${table}(author_id,kind,creation_key,form) values($1,$2,$3,$4) returning id`,[owner,kind,randomUUID(),{kind,title:'Историческая публикация',photoIds:[photo]}])).rows[0].id;
    await admin.query(`insert into app.${photos}(publication_id,media_id,position) values($1,$2,0)`,[target,photo]);const intent=await insertMediaPayment(admin,owner,type,target);
    assert.deepEqual(await events(intent),[photo]);await admin.query(`delete from app.${photos} where publication_id=$1`,[target]);await admin.query(`update app.${table} set form=form-'photoIds' where id=$1`,[target]);
    assert.deepEqual(await events(intent),[photo]);
   }
  });
  await suite.test('application payment uses its stored snapshot, never the current parent photos',async()=>{
   await clock(0);const stored=await media(),current=await media();
   const target=(await admin.query("insert into app.work_publications(author_id,kind,creation_key,form) values($1,'workRequest',$2,$3) returning id",[owner,randomUUID(),{kind:'workRequest',title:'Заказ для отклика'}])).rows[0].id;
   await admin.query('insert into app.work_publication_photos(publication_id,media_id,position) values($1,$2,0)',[target,current]);
   const application=(await admin.query('insert into app.applications(applicant_id,work_publication_id,creation_key,target_revision,specialist_revision,snapshot) values($1,$2,$3,1,1,$4) returning id',[owner,target,randomUUID(),{photoIds:[stored]}])).rows[0].id;
   const intent=await insertMediaPayment(admin,owner,'application',application);
   assert.equal((await admin.query('select capture_type from app.media_payment_reference_captures where intent_id=$1',[intent])).rows[0].capture_type,'exact');assert.deepEqual(await events(intent),[stored]);
   await admin.query("update app.applications set snapshot='{}' where id=$1",[application]);assert.deepEqual(await events(intent),[stored]);
  });
  await suite.test('seven days use the latest event time; attach then detach restarts the wait',async()=>{
   await clock(0);const photo=await media(),target=await listing();
   await clock(7*day-1);await assert.rejects(request(admin,photo),error=>error.code==='MRJ02');
   await clock(6*day);await admin.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)',[target,photo]);await admin.query('delete from app.listing_photos where listing_id=$1',[target]);
   await clock(13*day-1);await assert.rejects(request(admin,photo),error=>error.code==='MRJ02');
   await clock(13*day);const operation=await request(admin,photo);assert.equal((await admin.query('select operation_id from app.media_retirement_requests where media_id=$1',[photo])).rows[0].operation_id,operation);
   await assert.rejects(admin.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)',[target,photo]),error=>error.code==='MRJ02');
  });
  await suite.test('completion releases budget and active owner usage once, preserving metadata and intent identity',async()=>{
   await clock(0);const photo=await media(),metadata=(await admin.query('select * from app.media_objects where id=$1',[photo])).rows[0];await clock(7*day);
   const before=await usage(),operation=await request(admin,photo);assert.deepEqual(await usage(),before);
   await holder.query('begin');await holder.query('insert into app.media_retirement_completions(media_id,operation_id) values($1,$2)',[photo,operation]);await holder.query('rollback');assert.deepEqual(await usage(),before);
   const wrong=randomUUID();await assert.rejects(admin.query('insert into app.media_retirement_completions(media_id,operation_id) values($1,$2)',[photo,wrong]),error=>error.code==='MRJ02');
   await holder.query('begin');await holder.query('insert into app.media_retirement_completions(media_id,operation_id) values($1,$2) on conflict(media_id) do nothing',[photo,operation]);
   const replay=waiter.query('insert into app.media_retirement_completions(media_id,operation_id) values($1,$2) on conflict(media_id) do nothing',[photo,operation]);replay.catch(()=>{});await holder.query('commit');await replay;
   const after=await usage();assert.equal(BigInt(before.budget.charged_bytes)-BigInt(after.budget.charged_bytes),128n);assert.equal(before.budget.charged_objects-after.budget.charged_objects,1);
   assert.equal(BigInt(before.owner.charged_bytes)-BigInt(after.owner.charged_bytes),128n);assert.equal(before.owner.charged_objects-after.owner.charged_objects,1);
   assert.deepEqual((await admin.query('select * from app.media_objects where id=$1',[photo])).rows[0],metadata);
   await admin.query('insert into app.media_retirement_completions(media_id,operation_id) values($1,$2) on conflict(media_id) do nothing',[photo,operation]);assert.deepEqual(await usage(),after);
   await assert.rejects(admin.query('insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,$2,$3,$4,$5,$6,$7)',[owner,metadata.intent_id,'image/webp',16,9,128,'c'.repeat(64)]),error=>error.code==='23505');
  });
  await suite.test('attachment versus terminal request checks references after the actual media lock wait',async()=>{
   async function waiting(client){const pid=(await client.query('select pg_backend_pid() pid')).rows[0].pid;return async()=>{const deadline=Date.now()+3000;for(;;){if((await admin.query("select wait_event_type='Lock' waiting from pg_stat_activity where pid=$1",[pid])).rows[0]?.waiting)return;assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,10));}};}
   for(const attachWins of [true,false]){
    await clock(0);const photo=await media(),target=await listing();await clock(8*day);
    await holder.query('begin');
    if(attachWins)await holder.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)',[target,photo]);else await request(holder,photo);
    const wait=await waiting(waiter);
    const pending=attachWins?request(waiter,photo):waiter.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)',[target,photo]);
    const rejected=assert.rejects(pending,error=>error.code==='MRJ02');
    try{await wait();await holder.query('commit');await rejected;}finally{await holder.query('rollback');await rejected;}
    assert.equal((await admin.query('select count(*)::int n from app.listing_photos where listing_id=$1',[target])).rows[0].n,attachWins?1:0);
   }
  });
  await suite.test('rolling the wall clock back cannot erase a newer retention observation',async()=>{
   await clock(0);const photo=await media(),target=await listing();
   await clock(10*day);await admin.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)',[target,photo]);
   await clock(0);await admin.query('delete from app.listing_photos where listing_id=$1',[target]);
   await clock(8*day);await assert.rejects(request(admin,photo),error=>error.code==='MRJ02');
  });
  await suite.test('pending terminal reservation prevents a late write attempt or ready transition',async()=>{
   await clock(0);const photo=(await admin.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,$2,'image/webp',16,9,128,$3) returning id",[owner,randomUUID(),'d'.repeat(64)])).rows[0].id;
   await clock(7*day);await request(admin,photo);
   await assert.rejects(admin.query('insert into app.media_write_attempts(media_id) values($1)',[photo]),error=>error.code==='MRJ02');
   await assert.rejects(admin.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=$1",[photo]),error=>error.code==='MRJ02');
   await assert.rejects(insertMediaPayment(admin,owner,'listing',randomUUID()),error=>error.code==='MRJ02');
  });
  await suite.test('runtime has no retirement, completion, clock or financial capture authority; histories are immutable',async()=>{
   await holder.query('set role media_journal_runtime');try{for(const sql of ['select * from app.media_payment_reference_captures','select * from app.media_active_usage','select app.media_retention_clock()',`insert into app.media_retirement_requests(media_id,operation_id) values(gen_random_uuid(),gen_random_uuid())`,`insert into app.media_retirement_completions(media_id,operation_id) values(gen_random_uuid(),gen_random_uuid())`])await assert.rejects(holder.query(sql),error=>error.code==='42501');}finally{await holder.query('reset role');}
   for(const table of ['media_payment_reference_captures','media_retirement_requests','media_retirement_completions'])for(const sql of [`delete from app.${table}`,`truncate app.${table} cascade`])await assert.rejects(admin.query(sql),error=>error.code==='23514');
   await holder.query('begin isolation level repeatable read');try{await assert.rejects(request(holder,ids[0]),error=>error.code==='MRJ01');}finally{await holder.query('rollback');}
  });
 }finally{await holder.query('rollback');await waiter.query('rollback');await admin.query(clockDefinition);assert.equal((await admin.query("select pg_get_functiondef('app.media_retention_clock()'::regprocedure) ddl")).rows[0].ddl,clockDefinition);}
}
