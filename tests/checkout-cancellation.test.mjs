import assert from 'node:assert/strict';import {test} from 'node:test';import {createRequire} from 'node:module';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const {parseCheckoutCancellation,readCheckoutCancellationEnabled}=load('checkout-cancellation-contract');
const {createCheckoutCancellationHandler}=load('checkout-cancellation-http'),{CheckoutCancellationError}=load('postgres-checkout-cancellation');
const {createCheckoutCancellationClient}=load('client-checkout-cancellation');
const owner='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002',input={paymentId:id,targetType:'workRequest'},origin='https://cancel.example.invalid',token='a'.repeat(64);
test('cancellation contract accepts only exact supported targets and local opt-in configuration',()=>{
 for(const targetType of ['listing','vacancy','workRequest','application'])assert.deepEqual(parseCheckoutCancellation({...input,targetType}),{...input,targetType});
 for(const value of [null,[],{}, {...input,targetType:'specialist'},{...input,targetType:['listing']},{...input,paymentId:'bad'},{...input,status:'failed'},{...input,merchant:'other'}])assert.throws(()=>parseCheckoutCancellation(value));
 assert.equal(readCheckoutCancellationEnabled({}),false);const env={BLIZHNIY_CHECKOUT_CANCELLATION:'local-v1',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045'};
 assert.equal(readCheckoutCancellationEnabled(env),true);for(const patch of [{BLIZHNIY_CHECKOUT_CANCELLATION:'enabled'},{BLIZHNIY_LOCAL_PRIMARY:undefined},{BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://site.example.invalid'}])assert.throws(()=>readCheckoutCancellationEnabled({...env,...patch}));
});
function fixture(error=null,limited=false){const calls=[];let factories=0;
 const handler=createCheckoutCancellationHandler({origin},()=>{factories++;return{limiter:{allowProduction:async()=>!limited},store:Object.fromEntries(['read','cancel'].map(method=>[method,async(...args)=>{calls.push([method,...args]);if(error)throw error;return method==='read'?null:{...input,state:'cancelled'};}]))};});
 const request=(body={...input,expectedOwnerId:owner},method='PUT',headers={},query='')=>new Request(origin+'/api/account/checkout-cancellation'+query,{method,headers:{host:new URL(origin).host,origin,'content-type':'application/json','x-real-ip':'192.0.2.8','x-blizhniy-request':'1',cookie:'__Host-blizhniy_session='+token,...headers},...(['GET','HEAD'].includes(method)?{}:{body:JSON.stringify(body)})});
 return{handler,request,calls,get factories(){return factories;}};
}
test('cancellation HTTP validates ingress and authority before loading runtime, never trusts financial claims',async()=>{
 for(const [method,headers,body,query,status] of [['GET',{},null,'',405],['PUT',{origin:'https://foreign.invalid'},undefined,'',403],['PUT',{'x-blizhniy-request':''},undefined,'',403],['PUT',{'x-real-ip':''},undefined,'',403],['PUT',{cookie:'',authorization:'Bearer '+token},undefined,'',401],['PUT',{},undefined,'?owner='+owner,400],['PUT',{'content-length':'5000'},undefined,'',413],['PUT',{}, {...input,expectedOwnerId:owner,status:'failed'},'',422]]){
  const f=fixture(),reply=await f.handler(f.request(body,method,headers,query));assert.equal(reply.status,status);assert.equal(f.factories,0);assert.deepEqual(f.calls,[]);
 }
});
test('cancellation HTTP distinguishes read/write, binds cookie owner and maps private failures without retrying',async()=>{
 const f=fixture();assert.deepEqual(await(await f.handler(f.request(undefined,'POST'))).json(),null);assert.deepEqual(await(await f.handler(f.request())).json(),{...input,state:'cancelled'});
 assert.deepEqual(f.calls,[['read',token,owner,input],['cancel',token,owner,input]]);
 for(const [error,status,code] of [[new CheckoutCancellationError('CHECKOUT_STARTED'),409,'CHECKOUT_STARTED'],[new CheckoutCancellationError('CHECKOUT_BUSY'),409,'CHECKOUT_BUSY'],[new CheckoutCancellationError('CHECKOUT_NOT_FOUND'),404,'CHECKOUT_NOT_FOUND'],[new(load('app-session-transaction').AppSessionAccessError)(),401,'UNAUTHENTICATED'],[Error('private SQL secret'),503,'CANCELLATION_UNAVAILABLE']]){
  const f=fixture(error),reply=await f.handler(f.request());assert.equal(reply.status,status);assert.deepEqual(await reply.json(),{error:{code}});assert.equal(f.calls.length,1);assert.equal(reply.headers.get('cache-control'),'no-store');
 }
 const l=fixture(null,true),reply=await l.handler(l.request());assert.equal(reply.status,429);assert.equal(reply.headers.get('retry-after'),'900');assert.deepEqual(l.calls,[]);
});
test('cancellation client uses bounded exact same-origin requests and validates acknowledgement identity',async()=>{
 const calls=[],client=createCheckoutCancellationClient(async(path,init)=>{calls.push([path,init]);return Response.json(init.method==='POST'?null:{...input,state:'cancelled'});});
 assert.equal(await client.read(owner,input),null);assert.deepEqual(await client.cancel(owner,input),{...input,state:'cancelled'});
 for(const [path,init] of calls){assert.equal(path,'/api/account/checkout-cancellation');assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.equal(init.headers['X-Blizhniy-Request'],'1');assert.deepEqual(JSON.parse(init.body),{...input,expectedOwnerId:owner});}
 for(const result of [null,{...input,state:'failed'},{...input,state:'cancelled',paymentId:owner},{...input,state:'cancelled',targetType:'listing'},{...input,state:'cancelled',ownerId:owner}])await assert.rejects(createCheckoutCancellationClient(async()=>Response.json(result)).cancel(owner,input),error=>error.code==='UNKNOWN');
});
test('cancellation client never automatically retries an uncertain write and pairs error status and code',async()=>{
 for(const [status,code,expected] of [[409,'CHECKOUT_STARTED','CHECKOUT_STARTED'],[409,'CHECKOUT_BUSY','CHECKOUT_BUSY'],[404,'CHECKOUT_NOT_FOUND','CHECKOUT_NOT_FOUND'],[503,'CHECKOUT_STARTED','UNKNOWN'],[503,'SQL secret','UNKNOWN']]){
  let calls=0;await assert.rejects(createCheckoutCancellationClient(async()=>{calls++;return Response.json({error:{code}},{status});}).cancel(owner,input),error=>error.code===expected&&!error.message.includes('SQL'));assert.equal(calls,1);
 }
 for(const response of [()=>{throw Error('Lost response');},()=>new Response(' '.repeat(8193)),()=>new Response(new Uint8Array([0xff])),()=>new Response('{')]){let calls=0;await assert.rejects(createCheckoutCancellationClient(async()=>{calls++;return response();}).cancel(owner,input),error=>error.code==='UNKNOWN');assert.equal(calls,1);}
 let calls=0;await assert.rejects(createCheckoutCancellationClient(async()=>{calls++;return Response.json(null);}).read(owner,input,{signal:AbortSignal.abort()}));assert.equal(calls,0);
});
test('hosted cancellation policy pins the owner and TEST shop to the active checkout capabilities',()=>{
 const {readCheckoutCancellationPolicy}=load('checkout-cancellation-policy');
 const env={
  BLIZHNIY_CHECKOUT_CANCELLATION:'hosted-test-v1',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',
  BLIZHNIY_LISTING_CHECKOUT:'prepare-only',BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_PAYMENT_MODE:'test',
  BLIZHNIY_PAYMENT_SHOP_ID:'12345678',YOOKASSA_SHOP_ID:'12345678',YOOKASSA_SECRET_KEY:'test_synthetic',
  BLIZHNIY_PAYMENT_RECEIPT_VAT:'1',BLIZHNIY_PAYMENT_TEST_USER_ID:owner,BLIZHNIY_LISTING_PAYMENT:'account-publication-test',
 };
 const admission={ownerId:owner,shopId:'12345678'},placement={...admission,publicationMode:'account-test-v1'};
 assert.deepEqual(readCheckoutCancellationPolicy(env),{listing:placement,vacancy:placement,workRequest:placement});
 assert.deepEqual(readCheckoutCancellationPolicy({...env,BLIZHNIY_APPLICATION_PAYMENT:'account-response-test',BLIZHNIY_SPECIALIST_PAYMENT:'account-publication-test'}),
  {listing:placement,vacancy:placement,workRequest:placement,application:admission,specialist:{...admission,publicationMode:'specialist-account-test-v1'}});
 assert.deepEqual(readCheckoutCancellationPolicy({...env,BLIZHNIY_LISTING_PAYMENT:'account-test'}),{listing:admission});
 assert.equal(readCheckoutCancellationPolicy({...env,BLIZHNIY_CHECKOUT_CANCELLATION:undefined}),null);
 for(const patch of [{BLIZHNIY_LOCAL_PRIMARY:'enabled'},{BLIZHNIY_AUTH_ORIGIN:origin},{BLIZHNIY_PAYMENT_MODE:'live'},
  {YOOKASSA_SECRET_KEY:'live_synthetic'},{YOOKASSA_SHOP_ID:'87654321'}])assert.throws(()=>readCheckoutCancellationPolicy({...env,...patch}));
 const local={BLIZHNIY_CHECKOUT_CANCELLATION:'local-v1',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045',BLIZHNIY_LISTING_WORKFLOW:'postmoderation'};
 assert.equal(readCheckoutCancellationPolicy(local).ad_marquee,undefined);
 assert.equal(readCheckoutCancellationPolicy({...local,BLIZHNIY_SERVICE_CHECKOUT:'local-v1'}).ad_marquee.shopId,'local-fixture-shop');
 assert.deepEqual(parseCheckoutCancellation({...input,targetType:'specialist'},{specialist:true}),{...input,targetType:'specialist'});
});
