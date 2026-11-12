import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';

export async function testRefundOperatorActions(suite,{admin,ownerDb,db,refundDb,purchase,load,operatorLoad,operator,merchant,provider,check}){
 const approve=(shop,source=db)=>new (operatorLoad('postgres-refund-approvals').PostgresRefundApprovalStore)(source,shop);
 const recovery=(shop,fetcher,source=db)=>operatorLoad('primary-refund-recovery').createPrimaryRefundRecovery(source,shop,fetcher);
 const lostGet=(remote)=>async(url,init)=>{if(init.method==='GET'&&String(url).includes('/v3/refunds/'))throw Error('Synthetic refund GET outage');return remote.fetcher(url,init);};
 async function account(role='admin'){
  const id=randomUUID(),token=randomBytes(32).toString('hex');
  await admin.query('insert into app.users(id,email,password_hash,role,email_verified_at) values($1,$2,$3,$4,clock_timestamp())',[id,id+'@operator.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128),role]);
  await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[load('identity').hashSessionToken(token),id]);return{id,token};
 }
 async function uncertain(actor=operator){
  const shop={...merchant,shopId:'operator-action-'+randomBytes(6).toString('hex')},item=await purchase({scope:shop});
  const approval=await approve(shop).approve(actor.token,actor.id,{id:randomUUID(),paymentIntentId:item.id,reason:'Проверка восстановления отдельным оператором.'});
  const remote=provider(item,approval.id,shop);
  assert.deepEqual(await load('placement-refund-worker').createPlacementRefundWorker(refundDb,shop,lostGet(remote)).tick(),{state:'deferred',code:'processing_unavailable'});
  const candidate=(await admin.query('select provider_refund_id as id from app.payment_refund_candidates where operation_id=$1',[approval.id])).rows[0];
  assert.ok(candidate);return{shop,item,approval,remote,action:{id:randomUUID(),operationId:approval.id,providerRefundId:candidate.id,reason:'Сверка результата после неопределённого ответа.'}};
 }
 await suite.test('compiled operator GET-recovers unread response compensation once without withdrawing the application or changing its history',async()=>{
  const shop={...merchant,shopId:'operator-response-'+randomBytes(6).toString('hex')},work=await purchase({kind:'workRequest',scope:shop});
  const application=(await admin.query("insert into app.applications(applicant_id,work_publication_id,creation_key,target_revision,specialist_revision,snapshot,is_paid,status,created_at,sent_at) values($1,$2,$3,1,1,'{}',true,'sent',clock_timestamp()-interval '7 days',clock_timestamp()-interval '6 days') returning id",[operator.id,work.targetId,randomUUID()])).rows[0].id;
  const id=randomUUID(),item={id,ownerId:operator.id,targetType:'application',targetId:application,targetRevision:'1',tariffId:'job-response',amount:'99.00',durationDays:null,shopId:shop.shopId,isTest:true,providerPaymentId:randomUUID(),capturedAt:new Date(Date.now()-6*86400000-1000).toISOString()};
  item.metadata={localPaymentId:id,targetId:application,targetType:'application',tariffId:'job-response'};
  const requestBody=JSON.stringify({amount:{value:item.amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://fixture.example.invalid/return'},metadata:item.metadata});
  await ownerDb.transaction(async tx=>{
   const {providerPaymentId,capturedAt,metadata,...binding}=item;assert.ok(providerPaymentId&&capturedAt&&metadata);
   await new (load('postgres-payment-intents').PostgresPaymentIntentStore)(ownerDb).persistInTransaction(tx,{...binding,requestBody});
   await tx.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,'application',$4,1)",[id,item.ownerId,randomUUID(),application]);
   await tx.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[id]);await tx.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)',[id,item.providerPaymentId]);
   await tx.query("update app.payment_orders set status='succeeded' where id=$1",[id]);await tx.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",[id,item.providerPaymentId,item.capturedAt]);
  });
  const discovery=new (load('postgres-application-compensation-discovery').PostgresApplicationCompensationDiscovery)(refundDb,shop);
  for(let page=0;page<100;page++){await discovery.scan(25);if((await admin.query('select count(*)::int as n from app.application_compensation_cases where payment_intent_id=$1',[id])).rows[0].n===1)break;}
  const remote=provider(item,id,shop),before=(await admin.query('select status,is_paid,snapshot,sent_at from app.applications where id=$1',[application])).rows[0];
  assert.deepEqual(await load('application-compensation-worker').createApplicationCompensationWorker(refundDb,shop,lostGet(remote)).tick(),{state:'deferred',code:'processing_unavailable'});
  const candidate=(await admin.query('select provider_refund_id as id from app.payment_refund_candidates where operation_id=$1',[id])).rows[0];assert.ok(candidate);
  const action={id:randomUUID(),operationId:id,providerRefundId:candidate.id,reason:'Сверка компенсации непросмотренного отклика.'};
  const recover=recovery(shop,async(url,init)=>{assert.equal(init.method,'GET');return remote.fetcher(url,init);});
  assert.equal((await recover.recover(operator.token,operator.id,action)).state,'applied');assert.equal((await recover.recover(operator.token,operator.id,action)).state,'applied');assert.equal(remote.posts(),1);
  assert.deepEqual((await admin.query('select status,is_paid,snapshot,sent_at from app.applications where id=$1',[application])).rows[0],before);
  assert.equal((await admin.query('select count(*)::int as n from app.application_compensation_refunds where payment_intent_id=$1',[id])).rows[0].n,1);
  assert.equal((await admin.query('select count(*)::int as n from app.notifications where event_key=$1',['application_compensation:'+id])).rows[0].n,1);await check();
 });
 await suite.test('compiled operator rejects ordinary, blocked, stale and mismatched sessions before approval or provider I/O',async()=>{
  const ordinary=await account('user'),blocked=await account(),stale=await account(),shop={...merchant,shopId:'operator-auth-'+randomBytes(6).toString('hex')},item=await purchase({scope:shop});
  await admin.query('update app.users set is_blocked=true where id=$1',[blocked.id]);await admin.query("update app.sessions set created_at=clock_timestamp()-interval '2 hours',last_seen_at=clock_timestamp()-interval '31 minutes' where token_hash=$1",[load('identity').hashSessionToken(stale.token)]);
  let http=0;
  for(const [actor,expected]of [[ordinary,ordinary.id],[blocked,blocked.id],[stale,stale.id],[operator,ordinary.id]]){
   const id=randomUUID();await assert.rejects(approve(shop).approve(actor.token,expected,{id,paymentIntentId:item.id,reason:'Проверка отсутствия полномочий.'}));
   await assert.rejects(recovery(shop,async()=>{http++;throw Error('Unexpected HTTP');}).recover(actor.token,expected,{id:randomUUID(),operationId:randomUUID(),providerRefundId:randomUUID(),reason:'Проверка отсутствия полномочий.'}));
   assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_approvals where id=$1',[id])).rows[0].n,0);
  }assert.equal(http,0);await check();
 });
 await suite.test('compiled recovery rechecks current administrator after remote GET and records no effect after revocation',async()=>{
  const actor=await account(),value=await uncertain(actor);let changed=false;
  await assert.rejects(recovery(value.shop,async(url,init)=>{
   assert.equal(init.method,'GET');const response=await value.remote.fetcher(url,init);
   if(!changed){changed=true;await admin.query("update app.users set role='user' where id=$1",[actor.id]);}return response;
  }).recover(actor.token,actor.id,value.action));
  assert.equal(changed,true);assert.equal(value.remote.posts(),1);
  assert.deepEqual((await admin.query('select phase from app.payment_refund_recovery_actions where action_id=$1',[value.action.id])).rows,[{phase:'requested'}]);
  assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_effects where operation_id=$1',[value.approval.id])).rows[0].n,0);await check();
 });
 await suite.test('lost final operator recovery COMMIT is read back with the same action without another HTTP request or effect',async()=>{
  const value=await uncertain();let lose=true;
  const uncertainDb={transaction:async work=>{
   let final=false;const result=await db.transaction(tx=>work({query:(sql,values)=>{if(sql.includes("'observe'"))final=true;return tx.query(sql,values);}}));
   if(final&&lose){lose=false;throw Error('Synthetic lost operator COMMIT');}return result;
  }};
  await assert.rejects(recovery(value.shop,value.remote.fetcher,uncertainDb).recover(operator.token,operator.id,value.action),/Synthetic lost operator COMMIT/);
  assert.equal((await recovery(value.shop,async()=>{throw Error('Terminal replay must not use HTTP');}).recover(operator.token,operator.id,value.action)).state,'applied');
  assert.equal(value.remote.posts(),1);assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_effects where operation_id=$1',[value.approval.id])).rows[0].n,1);
  assert.equal((await admin.query('select count(*)::int as n from app.notifications where event_key=$1',['placement_refund:'+value.item.id])).rows[0].n,1);await check();
 });
}
