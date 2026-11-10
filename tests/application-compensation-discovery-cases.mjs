import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
export async function testApplicationCompensationDiscovery(suite,{admin,db,ownerDb,purchase,provider,load}) {
 await admin.query(await readFile(new URL('../database/migrations/0050-application-compensation-discovery.sql',import.meta.url),'utf8'));
 await admin.query('grant execute on function app.next_application_compensation_candidates(text,integer) to compensation_refund_worker');
 const {PostgresApplicationCompensationDiscovery}=load('postgres-application-compensation-discovery'),{createApplicationCompensationWorker}=load('application-compensation-worker');
 function context(){
  const merchant={shopId:'discovery-'+randomUUID().slice(0,8),isTest:true},discovery=new PostgresApplicationCompensationDiscovery(db,merchant);
  return{merchant,discovery,make:options=>purchase({...options,scope:merchant})};
 }
 const due=merchant=>admin.query("update app.application_compensation_discovery set next_scan_at=clock_timestamp()-interval '1 second' where merchant_shop_id=$1",[merchant.shopId]);
 const saved=async item=>(await admin.query('select * from app.application_compensation_cases where payment_intent_id=$1',[item.id])).rows[0]??null;
 await suite.test('automatic compensation intake has a bounded durable rescan cursor',async()=>{
  assert.notEqual((await admin.query("select to_regclass('app.application_compensation_discovery') as name")).rows[0].name,null);
 });
 await suite.test('a complete sweep discovers an unread mature response, enqueues and compensates it without manual claim',async()=>{
  const {merchant,make}=context(),item=await make(),remote=await provider(item,merchant);
  const worker=createApplicationCompensationWorker(db,{...merchant,secretKey:'test_synthetic_discovery'},remote.fetcher),result=await worker.sweep();
  assert.equal(result.discovery.scanned,1);assert.equal(result.discovery.claimed,1);assert.equal(result.processing.state,'completed');assert.equal((await saved(item)).reason,'unread-five-days');
  assert.equal((await admin.query('select status from app.payment_orders where id=$1',[item.id])).rows[0].status,'refunded');
  assert.equal(remote.calls.filter(call=>call.method==='POST').length,1);
  const previous=remote.calls.length;assert.equal((await worker.sweep()).processing.state,'idle');assert.equal(remote.calls.length,previous);
 });
 await suite.test('raw row limits advance through unpaid history and reach later captured candidates',async()=>{
  const {discovery,make}=context();for(let i=0;i<4;i++)await make({captured:false});const item=await make();
  for(let i=0;i<2;i++){const result=await discovery.scan(2);assert.equal(result.scanned,2);assert.equal(result.skipped,2);assert.equal(result.claimed,0);}
  const result=await discovery.scan(2);assert.equal(result.scanned,1);assert.equal(result.claimed,1);assert.ok(await saved(item));
 });
 await suite.test('a waiting response is revisited after its five-day condition matures',async()=>{
  const {merchant,discovery,make}=context(),item=await make();
  await admin.query("update app.applications set sent_at=clock_timestamp()-interval '1 day' where id=$1",[item.application]);
  assert.equal((await discovery.scan()).waiting,1);assert.equal(await saved(item),null);assert.equal((await discovery.scan()).scanned,0);
  await admin.query("update app.applications set sent_at=clock_timestamp()-interval '6 days' where id=$1",[item.application]);await due(merchant);
  assert.equal((await discovery.scan()).claimed,1);assert.ok(await saved(item));
 });
 await suite.test('early selection is discovered without an age-only SQL filter',async()=>{
  const {discovery,make}=context(),chosen=await make({ageDays:1}),other=await make({ageDays:1,workId:chosen.work});
  await admin.query("update app.applications set status='selected',revision=revision+1,updated_at=clock_timestamp() where id=$1",[chosen.application]);
  const result=await discovery.scan();assert.equal(result.scanned,2);assert.equal(result.claimed,1);assert.equal(result.ineligible,1);
  assert.equal((await saved(other)).reason,'other-selected-unread');assert.equal(await saved(chosen),null);
 });
 await suite.test('authorized early view and legacy-unknown evidence never become automatic unread claims',async()=>{
  const {discovery,make}=context(),viewed=await make({ageDays:1}),legacy=await make();
  await admin.query('insert into app.application_contact_views(application_id,recipient_id) values($1,$2)',[viewed.application,viewed.recipient]);
  await admin.query('alter table app.application_contact_views disable trigger application_contact_view_guard');
  try{await admin.query("insert into app.application_contact_views(application_id,recipient_id,evidence) values($1,$2,'legacy_unknown')",[legacy.application,legacy.recipient]);}
  finally{await admin.query('alter table app.application_contact_views enable always trigger application_contact_view_guard');}
  const result=await discovery.scan();assert.equal(result.ineligible,1);assert.equal(result.unavailable,1);assert.equal(result.claimed,0);assert.equal(await saved(viewed),null);assert.equal(await saved(legacy),null);
 });
 await suite.test('an authentic customer removal creates an early unread compensation through discovery',async()=>{
  const {discovery,make}=context(),item=await make({ageDays:1}),token=randomBytes(32).toString('hex');
  await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[load('identity').hashSessionToken(token),item.recipient]);
  await new (load('postgres-work-owner-actions').PostgresWorkOwnerActions)(ownerDb).change(token,item.recipient,{operationId:randomUUID(),publicationId:item.work,kind:'workRequest',expectedRevision:'1',action:'remove',reason:'Синтетическое закрытие заказа'});
  assert.equal((await discovery.scan()).claimed,1);assert.equal((await saved(item)).reason,'customer-closed-unread');
 });
 await suite.test('pending capture arriving after the cursor passed is discovered on the next bounded sweep',async()=>{
  const {merchant,discovery,make}=context(),item=await make({captured:false});assert.equal((await discovery.scan()).skipped,1);await discovery.scan();
  await admin.query("update app.payment_orders set status='succeeded' where id=$1",[item.id]);await admin.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",[item.id,item.providerPaymentId,new Date(Date.now()-6*86400000-1000).toISOString()]);await due(merchant);
  assert.equal((await discovery.scan()).claimed,1);assert.ok(await saved(item));
 });
 await suite.test('a fixed upper bound finishes the old pass and admits later arrivals in a new cycle',async()=>{
  const {merchant,discovery,make}=context(),first=await make();assert.equal((await discovery.scan(1)).claimed,1);
  const later=await make();assert.equal((await discovery.scan(1)).scanned,0);assert.equal(await saved(later),null);await due(merchant);
  const result=await discovery.scan(2);assert.equal(result.scanned,2);assert.equal(result.skipped,1);assert.equal(result.claimed,1);assert.ok(await saved(first));assert.ok(await saved(later));
 });
 await suite.test('a real intent INSERT committing behind the cursor is admitted in the next cycle',async()=>{
  const {merchant,discovery,make}=context(),base=await make({captured:false}),id=randomUUID(),providerPaymentId=randomUUID();
  await admin.query("update app.payment_orders set status='failed' where id=$1",[base.id]);
  const body=JSON.parse(base.requestBody);body.metadata.localPaymentId=id;const lock=await admin.connect();
  try{await lock.query('begin');
   await new (load('postgres-payment-intents').PostgresPaymentIntentStore)(db).persistInTransaction(lock,{id,ownerId:base.applicant,targetType:'application',targetId:base.application,targetRevision:'1',tariffId:'job-response',amount:'99.00',durationDays:null,...merchant,requestBody:JSON.stringify(body)});
   await lock.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,'application',$4,1)",[id,base.applicant,randomUUID(),base.application]);
   await lock.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[id]);await lock.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)',[id,providerPaymentId]);
   await lock.query("update app.payment_orders set status='succeeded' where id=$1",[id]);await lock.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",[id,providerPaymentId,new Date(Date.now()-6*86400000-1000).toISOString()]);
   await make({ageDays:1});assert.equal((await discovery.scan()).claimed,0);await lock.query('commit');
   assert.equal((await discovery.scan()).scanned,0);await due(merchant);assert.equal((await discovery.scan()).claimed,1);assert.equal((await saved({id})).application_id,base.application);
  }finally{await lock.query('rollback');lock.release();}
 });
 await suite.test('concurrent discovery skips a locked cursor and leaves the source for the next scanner',async()=>{
  const {merchant,discovery,make}=context(),item=await make(),lock=await admin.connect();
  await admin.query('insert into app.application_compensation_discovery(merchant_shop_id) values($1)',[merchant.shopId]);
  try{await lock.query('begin');await lock.query('select merchant_shop_id from app.application_compensation_discovery where merchant_shop_id=$1 for update',[merchant.shopId]);
   assert.equal((await discovery.scan()).scanned,0);assert.equal(await saved(item),null);await lock.query('commit');assert.equal((await discovery.scan()).claimed,1);
  }finally{await lock.query('rollback');lock.release();}
 });
 await suite.test('unknown discovery page COMMIT performs no intake and the next cycle safely revisits the page',async()=>{
  const {merchant,make}=context(),item=await make();let lose=true;
  const uncertain={transaction:async work=>{const result=await db.transaction(work);if(lose){lose=false;throw Error('Synthetic lost discovery page COMMIT');}return result;}};
  const discovery=new PostgresApplicationCompensationDiscovery(uncertain,merchant);
  await assert.rejects(discovery.scan(),/lost discovery page COMMIT/);assert.equal(await saved(item),null);assert.equal((await discovery.scan()).scanned,0);await due(merchant);
  assert.equal((await discovery.scan()).claimed,1);assert.ok(await saved(item));
 });
 await suite.test('one invalid captured source is counted without starving a later legitimate candidate',async()=>{
  const {discovery,make}=context(),bad=await make({captured:false}),good=await make();
  await admin.query("update app.payment_orders set status='succeeded' where id=$1",[bad.id]);await admin.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",[bad.id,bad.providerPaymentId,new Date(Date.now()+86400000).toISOString()]);
  const result=await discovery.scan();assert.equal(result.unavailable,1);assert.equal(result.claimed,1);assert.equal(await saved(bad),null);assert.ok(await saved(good));
 });
 await suite.test('an unknown intake COMMIT still leaves one authoritative queued case for the financial worker',async()=>{
  const {merchant,make}=context(),item=await make(),remote=await provider(item,merchant);let lose=true;
  const uncertain={transaction:async work=>{
   let intake=false;const value=await db.transaction(tx=>work({query:(sql,values)=>{if(sql.startsWith('insert into app.application_compensation_cases'))intake=true;return tx.query(sql,values);}}));
   if(intake&&lose){lose=false;throw Error('Synthetic lost intake COMMIT');}return value;
  }};
  const result=await createApplicationCompensationWorker(uncertain,{...merchant,secretKey:'test_synthetic_intake'},remote.fetcher).sweep();
  assert.equal(result.discovery.unavailable,1);assert.equal(result.discovery.claimed,0);assert.equal(result.processing.state,'completed');assert.ok(await saved(item));
  assert.equal(remote.calls.filter(call=>call.method==='POST').length,1);assert.equal((await admin.query('select count(*)::int as n from app.application_compensation_refunds where payment_intent_id=$1',[item.id])).rows[0].n,1);
 });
 await suite.test('discovery stays merchant-scoped and the worker cannot alter cursor or bypass page bounds',async()=>{
  const {merchant,make}=context();await make();const other=new PostgresApplicationCompensationDiscovery(db,{...merchant,shopId:'no-discovery-payments'});assert.equal((await other.scan()).scanned,0);
  await assert.rejects(db.query('select * from app.application_compensation_discovery'),{code:'42501'});await assert.rejects(db.query('delete from app.application_compensation_discovery where false'),{code:'42501'});
  await assert.rejects(db.query('select app.next_application_compensation_candidates($1,26)',[merchant.shopId]),{code:'22023'});
 });
}
