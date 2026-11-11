import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';

export async function testRefundRecovery(suite,{admin,ownerDb,purchase,provider,load,merchant,config,effects,notifications,expireWindow,store}){
 await admin.query(await readFile(new URL('../database/migrations/0051-refund-recovery.sql',import.meta.url),'utf8'));
 const {PostgresDatabase}=load('postgres'),{hashSessionToken}=load('identity'),{createPrimaryRefundRecovery}=load('primary-refund-recovery');
 const password=randomBytes(24).toString('hex');
 await admin.query(`create role refund_recovery_operator login password ${pg.escapeLiteral(password)} nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  grant connect on database blizhniy_test to refund_recovery_operator;grant usage on schema app to refund_recovery_operator;
  grant select on app.users,app.sessions,app.payment_checkout_intents,app.payment_orders,app.payment_provider_links,app.payment_verifications,
   app.payment_refund_reservations,app.payment_refund_requests,app.payment_refund_dispatch_anchors,app.payment_refund_send_attempts,
   app.payment_refund_candidates,app.payment_refund_provider_links,app.payment_refund_observations,app.payment_refund_effects,
   app.application_compensation_refunds,app.payment_refund_recovery_actions to refund_recovery_operator;
  grant update(id) on app.users,app.payment_checkout_intents,app.payment_orders to refund_recovery_operator;
  grant update(last_seen_at) on app.sessions to refund_recovery_operator;
  grant insert(operation_id,provider_refund_id) on app.payment_refund_provider_links to refund_recovery_operator;
  grant insert(operation_id,provider_refund_id,status,provider_created_at) on app.payment_refund_observations to refund_recovery_operator;
  grant insert(operation_id,merchant_shop_id) on app.payment_refund_effects to refund_recovery_operator;
  grant insert(payment_intent_id,merchant_shop_id) on app.application_compensation_refunds to refund_recovery_operator;
  grant insert(action_id,operation_id,provider_refund_id,reason,phase) on app.payment_refund_recovery_actions to refund_recovery_operator;
  grant execute on function app.lock_refund_recovery_source(uuid,uuid),app.refund_target_admitted(uuid,uuid) to refund_recovery_operator`);
 const db=new PostgresDatabase(new pg.Pool({...admin.options,user:'refund_recovery_operator',password,max:5}));
 async function account(role='admin'){
  const id=randomUUID(),token=randomBytes(32).toString('hex');
  await admin.query('insert into app.users(id,email,password_hash,role,email_verified_at) values($1,$2,$3,$4,clock_timestamp())',[id,id+'@recovery.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128),role]);
  await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[hashSessionToken(token),id]);return{id,token};
 }
 const operator=await account(),other=await account(),ordinary=await account('user');
 const input=(item,remote)=>({id:randomUUID(),operationId:item.id,providerRefundId:remote.state.refundId,reason:'Сверка результата после потери ответа'});
 const audit=async id=>(await admin.query('select phase,operator_id,provider_refund_id from app.payment_refund_recovery_actions where action_id=$1 order by phase',[id])).rows;
 const attempts=async id=>(await admin.query('select count(*)::int as n from app.payment_refund_send_attempts where operation_id=$1',[id])).rows[0].n;
 async function uncertain(){const item=await purchase(),remote=await provider(item);remote.state.losePost=true;await assert.rejects(remote.processor.process(item.id));remote.state.losePost=false;return{item,remote};}
 const recover=(remote,source=db)=>createPrimaryRefundRecovery(source,config,remote.fetcher);
 try{
  await suite.test('operator GET recovers expired UNKNOWN and a capped job without renewing key, window or attempts',async()=>{
   const {item,remote}=await uncertain(),action=input(item,remote);await expireWindow(item.id);
   await admin.query("update app.application_compensation_jobs set state='blocked',attempts=12,claim_id=null,last_code='attempts_exhausted' where payment_intent_id=$1",[item.id]);
   const before=await attempts(item.id),anchor=(await admin.query('select authorized_at from app.payment_refund_dispatch_anchors where operation_id=$1',[item.id])).rows[0],previous=remote.calls.length;
   const result=await recover(remote).recover(operator.token,operator.id,action);
   assert.equal(result.state,'applied');assert.equal(result.audit.operatorId,operator.id);assert.equal(await effects(item),1);assert.equal(await notifications(item),1);
   assert.ok(remote.calls.slice(previous).length>0);assert.ok(remote.calls.slice(previous).every(call=>call.method==='GET'));
   assert.equal(await attempts(item.id),before);assert.deepEqual((await admin.query('select authorized_at from app.payment_refund_dispatch_anchors where operation_id=$1',[item.id])).rows[0],anchor);
   assert.deepEqual((await admin.query('select state,attempts,claim_id,last_code from app.application_compensation_jobs where payment_intent_id=$1',[item.id])).rows[0],{state:'completed',attempts:12,claim_id:null,last_code:null});
   assert.deepEqual((await audit(action.id)).map(row=>row.phase),['requested','succeeded']);
  });
  await suite.test('pending recovery appends success on the same action; canceled keeps the original payment and blocks the job',async()=>{
   for(const state of ['pending','canceled']){
    const {item,remote}=await uncertain(),action=input(item,remote);remote.state.status=state;const previous=remote.calls.length;
    assert.equal((await recover(remote).recover(operator.token,operator.id,action)).state,state);assert.equal(await effects(item),0);assert.equal(await notifications(item),0);
    if(state==='pending'){
     remote.state.status='succeeded';assert.equal((await recover(remote).recover(operator.token,operator.id,action)).state,'applied');
     assert.deepEqual((await audit(action.id)).map(row=>row.phase),['pending','requested','succeeded']);assert.equal(await effects(item),1);
    }else{
     assert.equal((await admin.query('select status from app.payment_orders where id=$1',[item.id])).rows[0].status,'succeeded');
     assert.deepEqual((await admin.query('select state,last_code from app.application_compensation_jobs where payment_intent_id=$1',[item.id])).rows[0],{state:'blocked',last_code:'provider_canceled'});
    }
    assert.ok(remote.calls.slice(previous).every(call=>call.method==='GET'));
   }
  });
  await suite.test('ordinary, blocked, expired and mismatched administrators cannot read remote data or write an audit',async()=>{
   const {item,remote}=await uncertain(),previous=remote.calls.length;
   const blocked=await account();await admin.query('update app.users set is_blocked=true where id=$1',[blocked.id]);
   const expired=await account();await admin.query("update app.sessions set created_at=clock_timestamp()-interval '2 hours',last_seen_at=clock_timestamp()-interval '31 minutes' where token_hash=$1",[hashSessionToken(expired.token)]);
   for(const [actor,expected] of [[ordinary,ordinary.id],[blocked,blocked.id],[expired,expired.id],[operator,other.id]]){
    const action=input(item,remote);await assert.rejects(recover(remote).recover(actor.token,expected,action));assert.deepEqual(await audit(action.id),[]);
   }
   assert.equal(remote.calls.length,previous);
  });
  await suite.test('revoked administrator during GET leaves only a requested audit, no verified link or financial effect',async()=>{
   const {item,remote}=await uncertain(),actor=await account(),action=input(item,remote),original=remote.fetcher;let revoked=false;
   const recovery=createPrimaryRefundRecovery(db,config,async(...args)=>{const result=await original(...args);if(!revoked){revoked=true;await admin.query("update app.users set role='user' where id=$1",[actor.id]);}return result;});
   await assert.rejects(recovery.recover(actor.token,actor.id,action));assert.equal(await effects(item),0);assert.equal(await notifications(item),0);
   assert.deepEqual((await audit(action.id)).map(row=>row.phase),['requested']);
   assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_provider_links where operation_id=$1',[item.id])).rows[0].n,0);
  });
  await suite.test('recovery rejects missing send proof, wrong merchant and a contradictory candidate before HTTP',async()=>{
   const item=await purchase(),remote=await provider(item);await store.claim(item.id);
   await new (load('postgres-application-compensation-refund').PostgresApplicationCompensationRefundStore)(ownerDb,merchant).reserve(item.id);
   await new (load('postgres-refund-requests').PostgresRefundRequestStore)(ownerDb,merchant).prepare(item.id);
   const previous=remote.calls.length;await assert.rejects(recover(remote).recover(operator.token,operator.id,input(item,remote)));assert.equal(remote.calls.length,previous);
   const attempted=await uncertain(),action=input(attempted.item,attempted.remote),before=attempted.remote.calls.length;
   await assert.rejects(createPrimaryRefundRecovery(db,{...config,shopId:'other-shop'},attempted.remote.fetcher).recover(operator.token,operator.id,action));
   const dispatch=new (load('postgres-refund-dispatch').PostgresRefundDispatchStore)(ownerDb,merchant),source=await dispatch.load(attempted.item.id);
   const attempt=(await admin.query('select id from app.payment_refund_send_attempts where operation_id=$1 limit 1',[attempted.item.id])).rows[0].id;
   await dispatch.bindCandidate(attempted.item.id,attempt,randomUUID(),source);
   await assert.rejects(recover(attempted.remote).recover(operator.token,operator.id,action));assert.equal(attempted.remote.calls.length,before);
  });
  await suite.test('wrong remote metadata, payment, full amount or test merchant never binds refund proof',async()=>{
   for(const mutate of [value=>({...value,metadata:{...value.metadata,localRefundId:randomUUID()}}),value=>({...value,payment_id:randomUUID()}),value=>({...value,amount:{value:'1.00',currency:'RUB'}}),value=>({...value,test:false})]){
    const {item,remote}=await uncertain(),action=input(item,remote),before=remote.calls.length;
    const recovery=createPrimaryRefundRecovery(db,config,async(...args)=>{const response=await remote.fetcher(...args),value=await response.json();return Response.json(mutate(value));});
    await assert.rejects(recovery.recover(operator.token,operator.id,action));assert.equal(await effects(item),0);assert.equal(await notifications(item),0);
    assert.ok(remote.calls.slice(before).every(call=>call.method==='GET'));assert.deepEqual((await audit(action.id)).map(row=>row.phase),['requested']);
   }
  });
  await suite.test('lost request, journal and final COMMIT acknowledgements recover on explicit same-action retry once',async()=>{
   for(const marker of ["'requested'",'insert into app.payment_refund_provider_links',"'observe'"]){
    const {item,remote}=await uncertain(),action=input(item,remote);let lose=true;
    const ambiguous={transaction:async work=>{let hit=false;const result=await db.transaction(tx=>work({query:(sql,values)=>{if(sql.includes(marker))hit=true;return tx.query(sql,values);}}));if(hit&&lose){lose=false;throw Error('Synthetic lost recovery COMMIT');}return result;}};
    const before=remote.calls.length;await assert.rejects(recover(remote,ambiguous).recover(operator.token,operator.id,action),/lost recovery COMMIT/);
    if(marker==="'requested'")assert.equal(remote.calls.length,before);
    const retry=marker==="'observe'"?createPrimaryRefundRecovery(ambiguous,config,async()=>{throw Error('Provider must not be needed for a committed terminal audit');}):recover(remote,ambiguous);
    assert.equal((await retry.recover(operator.token,operator.id,action)).state,'applied');assert.equal(await effects(item),1);assert.equal(await notifications(item),1);
    assert.deepEqual((await audit(action.id)).map(row=>row.phase),['requested','succeeded']);assert.ok(remote.calls.slice(before).every(call=>call.method==='GET'));
   }
  });
  await suite.test('conflicting action identity or actor cannot reuse its audit and concurrent exact repeats settle once',async()=>{
   const {item,remote}=await uncertain(),action=input(item,remote);remote.state.status='pending';await recover(remote).recover(operator.token,operator.id,action);
   const before=remote.calls.length;
   for(const changed of [{...action,reason:'Другая причина'},{...action,providerRefundId:randomUUID()}])await assert.rejects(recover(remote).recover(operator.token,operator.id,changed));
   await assert.rejects(recover(remote).recover(other.token,other.id,action));assert.equal(remote.calls.length,before);
   remote.state.status='succeeded';const results=await Promise.all([recover(remote).recover(operator.token,operator.id,action),recover(remote).recover(operator.token,operator.id,action)]);
   assert.ok(results.every(result=>result.state==='applied'));assert.equal(await effects(item),1);assert.equal(await notifications(item),1);
  });
  await suite.test('narrow operator cannot send, reset attempts, forge outcomes or mutate recovery history',async()=>{
   for(const sql of ["insert into app.payment_refund_send_attempts default values","insert into app.payment_refund_reservations default values","update app.application_compensation_jobs set attempts=0 where false","update app.payment_orders set status='refunded' where false","update app.payment_refund_recovery_actions set reason='changed' where false","delete from app.payment_refund_recovery_actions where false","truncate app.payment_refund_recovery_actions","insert into app.payment_refund_recovery_actions(action_id,phase,operator_id) values(gen_random_uuid(),'succeeded',gen_random_uuid())"])
    await assert.rejects(db.query(sql),{code:'42501'});
   const {item,remote}=await uncertain(),action=input(item,remote);
   await assert.rejects(db.query("insert into app.payment_refund_recovery_actions(action_id,operation_id,provider_refund_id,reason,phase) values($1,$2,$3,$4,'requested')",[action.id,action.operationId,action.providerRefundId,action.reason]),{code:'42501'});
   await assert.rejects(db.transaction(async tx=>{await tx.query("select set_config('blizhniy.refund_recovery_session',$1,true)",[hashSessionToken(ordinary.token)]);await tx.query("insert into app.payment_refund_recovery_actions(action_id,operation_id,provider_refund_id,reason,phase) values($1,$2,$3,$4,'requested')",[action.id,action.operationId,action.providerRefundId,action.reason]);}),{code:'42501'});
  });
  await suite.test('direct SQL recovery rechecks session expiry after a real queue row lock wait',async()=>{
   const {item,remote}=await uncertain();await remote.processor.process(item.id);
   const actor=await account(),action=input(item,remote),hash=hashSessionToken(actor.token);
   await admin.query("update app.sessions set expires_at=clock_timestamp()+interval '1200 milliseconds' where token_hash=$1",[hash]);
   const insert=phase=>db.transaction(async tx=>{await tx.query("select set_config('blizhniy.refund_recovery_session',$1,true)",[hash]);return tx.query('insert into app.payment_refund_recovery_actions(action_id,operation_id,provider_refund_id,reason,phase) values($1,$2,$3,$4,$5)',[action.id,action.operationId,action.providerRefundId,action.reason,phase]);});
   await insert('requested');
   await admin.query("update app.application_compensation_jobs set state='blocked',claim_id=null,last_code='attempts_exhausted' where payment_intent_id=$1",[item.id]);
   const locker=await admin.connect();let outcome;
   try{
    await locker.query('begin');await locker.query('select payment_intent_id from app.application_compensation_jobs where payment_intent_id=$1 for update',[item.id]);
    outcome=insert('observe').then(value=>({value}),error=>({error}));
    const deadline=Date.now()+1000;let waiting=false;
    while(Date.now()<deadline){waiting=(await admin.query("select exists(select 1 from pg_stat_activity where usename='refund_recovery_operator' and wait_event_type='Lock') as waiting")).rows[0].waiting;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(waiting,true);await new Promise(resolve=>setTimeout(resolve,1250));await locker.query('commit');
    assert.equal((await outcome).error?.code,'42501');assert.deepEqual((await audit(action.id)).map(row=>row.phase),['requested']);
    assert.equal((await admin.query('select state from app.application_compensation_jobs where payment_intent_id=$1',[item.id])).rows[0].state,'blocked');
   }finally{await locker.query('rollback');locker.release();if(outcome)await outcome;}
  });
  await suite.test('an administrator recovers only the original approved placement operation, including a distinct operation UUID',async()=>{
   const base=await purchase(),id=randomUUID(),operationId=randomUUID(),providerPaymentId=randomUUID(),targetId=randomUUID();
   const requestBody=JSON.stringify({amount:{value:'199.00',currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://fixture.example.invalid/return'},metadata:{localPaymentId:id,targetType:'listing',targetId,tariffId:'listing-publication'}});
   await ownerDb.transaction(async tx=>{
    await new (load('postgres-payment-intents').PostgresPaymentIntentStore)(ownerDb).persistInTransaction(tx,{id,ownerId:base.applicant,targetType:'listing',targetId,targetRevision:'1',tariffId:'listing-publication',amount:'199.00',durationDays:30,...merchant,requestBody});
    await tx.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,'listing',$4,1)",[id,base.applicant,randomUUID(),targetId]);
    await tx.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[id]);await tx.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)',[id,providerPaymentId]);
    await tx.query("update app.payment_orders set status='succeeded' where id=$1",[id]);await tx.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",[id,providerPaymentId,new Date(Date.now()-3600000).toISOString()]);
   });
   await new (load('postgres-placement-refund-reservations').PostgresPlacementRefundReservationStore)(ownerDb,merchant).reserve(id,operationId);
   await new (load('postgres-refund-requests').PostgresRefundRequestStore)(ownerDb,merchant).prepare(operationId);
   await new (load('postgres-refund-dispatch').PostgresRefundDispatchStore)(ownerDb,merchant).authorize(operationId,randomUUID());
   const remote=await provider({...base,id,providerPaymentId,requestBody}),action={...input({id:operationId},remote)};
   const recovery=createPrimaryRefundRecovery(db,config,async(...args)=>{const response=await remote.fetcher(...args),value=await response.json();if(value.metadata?.localRefundId)value.metadata.localRefundId=operationId;return Response.json(value);});
   await assert.rejects(recovery.recover(operator.token,operator.id,action));assert.equal(remote.calls.length,0);
   await new (load('postgres-refund-approvals').PostgresRefundApprovalStore)(ownerDb,merchant).approve(operator.token,operator.id,{id:operationId,paymentIntentId:id,reason:'Полный возврат платы за размещение'});
   const result=await recovery.recover(other.token,other.id,action);assert.equal(result.state,'applied');assert.equal(result.verification.paymentIntentId,id);assert.equal(result.audit.operatorId,other.id);
   assert.ok(remote.calls.every(call=>call.method==='GET'));
   assert.equal((await admin.query('select status from app.payment_orders where id=$1',[id])).rows[0].status,'refunded');
   assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_effects where operation_id=$1',[operationId])).rows[0].n,1);
  });
 }finally{await db.close();}
}
