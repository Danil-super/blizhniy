import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import pg from 'pg';

export async function testUnpaidDraftRemoval(suite,{admin,config,owner,other,purchase,intents,cancel,load}){
 const candidate=new URL('../database/candidates/0070-unpaid-draft-removal.sql',import.meta.url);
 const permission=new URL('../database/permissions/unpaid-draft-removal.sql',import.meta.url);
 const password=randomBytes(24).toString('hex');
 await admin.query(await readFile(candidate,'utf8'));
 await admin.query(`create role blizhniy_runtime login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password ${pg.escapeLiteral(password)};
  grant connect on database blizhniy_test to blizhniy_runtime;
  grant usage on schema app to blizhniy_runtime;
  grant select on app.users,app.sessions,app.listings,app.listing_blocks,app.listing_owner_removals,app.listing_photos,app.media_objects,
   app.cities,app.categories,app.specialist_categories,app.payment_orders,app.service_publications,app.service_publication_photos to blizhniy_runtime;
  grant update(auth_version) on app.users to blizhniy_runtime;
  grant update(last_seen_at) on app.sessions to blizhniy_runtime;
  grant update(title,description,listing_type,price,category_id,city_id,revision,updated_at) on app.listings to blizhniy_runtime;
  grant insert(author_id,kind,creation_key,form,city_id,profession_id),
   update(form,city_id,profession_id,revision,updated_at) on app.service_publications to blizhniy_runtime`);
 await admin.query(await readFile(permission,'utf8'));
 const {PostgresDatabase}=load('postgres');
 const db=new PostgresDatabase(new pg.Pool({...config,user:'blizhniy_runtime',password,max:4}));
 const {PostgresListingOwnerRemovalStore}=load('postgres-listing-owner-removals');
 const store=new PostgresListingOwnerRemovalStore(db);
 const drafts=new (load('postgres-listing-drafts').PostgresListingDraftStore)(db);
 const forms=new (load('postgres-listing-form').PostgresListingFormStore)(db,{renewals:true});
 const cabinet=new (load('postgres-listing-cabinet').PostgresListingCabinetStore)(db,true);
 const {PostgresServicePublicationStore,ServicePublicationAccessError}=load('postgres-service-publications');
 const services=new PostgresServicePublicationStore(db);
 const remove=(id,target,revision='1')=>store.remove(owner.token,owner.id,id,revision,target);
 const read=(id,target,revision='1')=>store.read(owner.token,owner.id,id,revision,target);
 const direct=(client,hash,actor,id,target,write=true)=>client.query(
  'select app.remove_unpaid_draft($1,$2,$3,$4,1,$5)',[hash,actor,target,id,write]);
 async function draft(target,kind='marquee'){
  const id=randomUUID(),key=randomUUID();
  if(target==='listing')await admin.query(
   "insert into app.listings(id,author_id,listing_type,title) values($1,$2,'sell','Синтетический черновик')",[id,owner.id]);
  else await admin.query("insert into app.service_publications(id,author_id,kind,creation_key,form) values($1,$2,$3,$4,$5)",
   [id,owner.id,kind,key,JSON.stringify({kind,title:'Синтетическая реклама'})]);
  return{id,key};
 }
 try{
  await suite.test('one owner draft decision is replayable, and a stale editor, list or creation readback cannot return it',async()=>{
   const listing=(await draft('listing')).id,{id:marquee,key}=await draft('marquee');
   assert.equal((await drafts.read(owner.token,owner.id,listing)).revision,'1');
   assert.equal((await services.readIntent(owner.token,owner.id,'marquee',key)).id,marquee);
   const listingCount=(await cabinet.list(owner.token,owner.id,null)).items.length;
   const marqueeCount=(await services.list(owner.token,owner.id,'marquee',null)).items.length;
   for(const [id,target] of [[listing,'listing'],[marquee,'marquee']]){
    assert.deepEqual(await read(id,target),{id,revision:'1',removed:false});
    const expected={id,revision:'1',removed:true};
    assert.deepEqual(await Promise.all([remove(id,target),remove(id,target)]),[expected,expected]);
    assert.deepEqual(await read(id,target),expected);
    await assert.rejects(remove(id,target,'2'),{name:'ListingDraftConflictError'});
   }
   assert.equal((await cabinet.list(owner.token,owner.id,null)).items.length,listingCount-1);
   assert.equal((await services.list(owner.token,owner.id,'marquee',null)).items.length,marqueeCount-1);
   assert.equal((await drafts.list(owner.token,owner.id,null)).items.some(item=>item.id===listing),false);
   await assert.rejects(forms.readEditable(owner.token,owner.id,listing),{name:'ListingDraftAccessError'});
   await assert.rejects(forms.checkPublication(owner.token,owner.id,listing,'1'),{name:'ListingDraftAccessError'});
   await assert.rejects(drafts.read(owner.token,owner.id,listing),{name:'ListingDraftAccessError'});
   await assert.rejects(drafts.update(owner.token,owner.id,listing,'1',{kind:'prodam',title:'Старая вкладка'}),{name:'ListingDraftAccessError'});
   await assert.rejects(services.read(owner.token,owner.id,'marquee',marquee),ServicePublicationAccessError);
   assert.equal(await services.readIntent(owner.token,owner.id,'marquee',key),null);
   await assert.rejects(services.update(owner.token,owner.id,'marquee',marquee,'1',{title:'Старая вкладка'}),ServicePublicationAccessError);
   await assert.rejects(services.create(owner.token,owner.id,'marquee',key,{title:'Повтор создания'}),ServicePublicationAccessError);
  });
  await suite.test('the SQL function binds owner, session, kind and privileges independently',async()=>{
   const {id}=await draft('listing'),{id:fair}=await draft('marquee','fair'),{id:specialist}=await draft('marquee','specialist');
   const privilege="has_function_privilege(current_user,'app.remove_unpaid_draft(text,uuid,text,uuid,bigint,boolean)','execute')";
   assert.equal((await db.query(`select ${privilege} as allowed`)).rows[0].allowed,true);
   assert.equal((await admin.query("select has_function_privilege('checkout_cancel_runtime','app.remove_unpaid_draft(text,uuid,text,uuid,bigint,boolean)','execute') as allowed")).rows[0].allowed,false);
   await assert.rejects(store.remove(other.token,other.id,id,'1','listing'),{name:'ListingDraftAccessError'});
   await assert.rejects(store.remove(other.token,owner.id,id,'1','listing'),{name:'ListingDraftAccessError'});
   await assert.rejects(direct(db,other.hash,owner.id,id,'listing'),{code:'PDR01'});
   await assert.rejects(direct(db,'0'.repeat(64),owner.id,id,'listing'),{code:'PDR04'});
   await assert.rejects(direct(db,owner.hash,owner.id,fair,'fair'),{code:'23514'});
   for(const foreignKind of [fair,specialist])await assert.rejects(remove(foreignKind,'marquee'),{name:'ListingDraftAccessError'});
   await assert.rejects(db.transaction(async tx=>{
    await tx.query('set transaction isolation level repeatable read');
    await direct(tx,owner.hash,owner.id,id,'listing');
   }),{code:'23514'});
   await assert.rejects(db.query("update app.listings set status='removed' where id=$1",[id]),{code:'42501'});
   await assert.rejects(db.query('delete from app.listings where id=$1',[id]),{code:'42501'});
   await assert.rejects(db.query("update app.payment_orders set status='failed' where false"),{code:'42501'});
   assert.deepEqual(await read(id,'listing'),{id,revision:'1',removed:false});
  });
  await suite.test('concurrent revision change wins over an old removal and lost acknowledgement is resolved by readback',async()=>{
   const {id}=await draft('listing'),locker=await admin.connect();
   let running;
   try{
    await locker.query('begin');
    await locker.query("update app.listings set title='Другая вкладка',revision=2 where id=$1",[id]);
    let pid,announce;
    const started=new Promise(resolve=>announce=resolve);
    const waiting=new PostgresListingOwnerRemovalStore({transaction:work=>db.transaction(async tx=>{
     pid=(await tx.query('select pg_backend_pid() pid')).rows[0].pid;announce();return work(tx);
    })});
    running=waiting.remove(owner.token,owner.id,id,'1','listing');running.catch(()=>{});
    await started;
    const deadline=Date.now()+3000;
    for(;;){
     if((await admin.query("select wait_event_type='Lock' waiting from pg_stat_activity where pid=$1",[pid])).rows[0]?.waiting)break;
     assert.ok(Date.now()<deadline,'Removal did not reach the listing lock');
     await new Promise(resolve=>setTimeout(resolve,10));
    }
    await locker.query('commit');
    await assert.rejects(running,{name:'ListingDraftConflictError'});
    assert.equal((await drafts.read(owner.token,owner.id,id)).draft.title,'Другая вкладка');
   }finally{await locker.query('rollback');await running?.catch(()=>{});locker.release();}
   const lost=new PostgresListingOwnerRemovalStore({transaction:async work=>{
    await db.transaction(work);throw Error('Synthetic lost COMMIT reply');
   }});
   await assert.rejects(lost.remove(owner.token,owner.id,id,'2','listing'),/Synthetic lost COMMIT/);
   const expected={id,revision:'2',removed:true},before=(await admin.query('select * from app.listings where id=$1',[id])).rows[0];
   assert.deepEqual(await read(id,'listing','2'),expected);
   assert.deepEqual(await remove(id,'listing','2'),expected);
   assert.deepEqual((await admin.query('select * from app.listings where id=$1',[id])).rows[0],before);
  });
  await suite.test('prepared, possibly dispatched and pending payments stop removal, with safe cancellation preserving history',async()=>{
   const {id}=await draft('listing'),binding=await purchase({targetId:id});
   await assert.rejects(remove(id,'listing'),{name:'DraftRemovalCheckoutActiveError'});
   await assert.rejects(read(id,'listing'),{name:'DraftRemovalCheckoutActiveError'});
   const source=(await admin.query('select * from app.payment_checkout_intents where id=$1',[binding.id])).rows[0];
   await cancel(owner,binding);
   assert.deepEqual(await remove(id,'listing'),{id,revision:'1',removed:true});
   assert.deepEqual((await admin.query('select * from app.payment_checkout_intents where id=$1',[binding.id])).rows[0],source);
   assert.equal((await admin.query('select status from app.payment_orders where id=$1',[binding.id])).rows[0].status,'failed');
   const unknown=(await draft('listing')).id,attempt=await purchase({targetId:unknown});
   assert.equal((await intents.authorize(attempt)).decision,'post');
   await assert.rejects(remove(unknown,'listing'),{name:'DraftRemovalCheckoutActiveError'});
   assert.equal((await admin.query('select status from app.payment_orders where id=$1',[attempt.id])).rows[0].status,'created');
   const ad=(await draft('marquee')).id,adOrder=await purchase({targetType:'ad_marquee',targetId:ad});
   await admin.query("update app.payment_orders set status='pending' where id=$1",[adOrder.id]);
   await assert.rejects(remove(ad,'marquee'),{name:'DraftRemovalCheckoutActiveError'});
   assert.equal((await services.read(owner.token,owner.id,'marquee',ad)).id,ad);
  });
  await suite.test('advertising removal also composes with the service payment terms and checkout fence',async()=>{
   const migrations=new URL('../database/migrations/',import.meta.url);
   const names=(await readdir(migrations)).filter(name=>/^00(?:4[8-9]|5[0-7])-[a-z-]+\.sql$/.test(name)).sort();
   assert.equal(names.length,10);
   for(const name of names)await admin.query(await readFile(new URL(name,migrations),'utf8'));
   const {id}=await draft('marquee'),busy=(await draft('marquee')).id;
   await purchase({targetType:'ad_marquee',targetId:busy});
   assert.deepEqual(await remove(id,'marquee'),{id,revision:'1',removed:true});
   await assert.rejects(remove(busy,'marquee'),{name:'DraftRemovalCheckoutActiveError'});
  });
 }finally{await db.close();}
}
