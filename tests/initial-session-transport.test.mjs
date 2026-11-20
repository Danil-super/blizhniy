import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAccountSessionState} from '../src/lib/account-session-state.ts';
import {productionAccount} from '../src/lib/local-account.ts';

const user={id:'11111111-1111-4111-8111-111111111111',email:'user@fixture.invalid',role:'user',isBlocked:false};
const ok=()=>Response.json({user});

test('a lost initial session read gets one fresh response within the original deadline',async t=>{
 const signals=[];
 t.mock.method(globalThis,'fetch',async(path,init)=>{
  assert.equal(path,'/api/account/session');
  signals.push(init.signal);
  if(signals.length===1)throw new TypeError('Failed to fetch');
  return ok();
 });
 const state=createAccountSessionState(productionAccount.session);
 await state.refresh();
 assert.deepEqual(state.read(),{state:'signed-in',userId:user.id});
 assert.equal(signals.length,2);
 assert.equal(signals[0],signals[1]);
});

test('an initial failure stops after one repeated transport failure',async t=>{
 const fetch=t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('Failed to fetch');});
 const state=createAccountSessionState(productionAccount.session);
 await state.refresh();
 assert.deepEqual(state.read(),{state:'unavailable',userId:null});
 assert.equal(fetch.mock.callCount(),2);
});

test('sign-out, malformed responses, rate limits and elapsed deadlines never trigger a transport retry',async t=>{
 for(const [response,expected] of [
  [()=>Response.json({error:{code:'UNAUTHENTICATED'}},{status:401}),'signed-out'],
  [()=>Response.json({error:{code:'RATE_LIMITED'}},{status:429}),'unavailable'],
  [()=>new Response('{'),'unavailable'],
  [()=>{throw new DOMException('deadline','TimeoutError');},'unavailable'],
 ]){
  const fetch=t.mock.method(globalThis,'fetch',response);
  const state=createAccountSessionState(productionAccount.session);
  await state.refresh();assert.equal(state.read().state,expected);
  assert.equal(fetch.mock.callCount(),1);fetch.mock.restore();
 }
});

test('a failed background read hides the verified identity immediately',async t=>{
 const fetch=t.mock.method(globalThis,'fetch',async()=>ok());
 const state=createAccountSessionState(productionAccount.session);
 await state.refresh();
 fetch.mock.mockImplementation(()=>Promise.reject(new TypeError('Failed to fetch')));
 await state.refresh(true);
 assert.deepEqual(state.read(),{state:'unavailable',userId:null});
 assert.equal(fetch.mock.callCount(),2);
});

test('a stopped or superseded initial read cannot initiate a retry',async t=>{
 for(const invalidate of [s=>s.stop(),s=>s.beginChange(),s=>s.refresh()]){
  let reject;
  const fetch=t.mock.method(globalThis,'fetch',()=>new Promise((_,r)=>{reject=r;}));
  const state=createAccountSessionState(productionAccount.session);
  const first=state.refresh();
  fetch.mock.mockImplementation(ok);
  await invalidate(state);
  const calls=fetch.mock.callCount();
  reject(new TypeError('Failed to fetch'));await first;
  assert.equal(fetch.mock.callCount(),calls);fetch.mock.restore();
 }
});

test('an expired shared deadline prevents retry even if the transport reports a generic network error',async t=>{
 const deadline=new AbortController();
 t.mock.method(AbortSignal,'timeout',()=>deadline.signal);
 const fetch=t.mock.method(globalThis,'fetch',async()=>{
  deadline.abort();throw new TypeError('Failed to fetch');
 });
 const state=createAccountSessionState(productionAccount.session);
 await state.refresh();
 assert.equal(state.read().state,'unavailable');assert.equal(fetch.mock.callCount(),1);
});

test('a login or logout with a lost response is sent exactly once',async t=>{
 const fetch=t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('Failed to fetch');});
 await assert.rejects(productionAccount.login('fixture@example.invalid','fixture-only'));
 await assert.rejects(productionAccount.logout());
 assert.deepEqual(fetch.mock.calls.map(call=>call.arguments[0]),['/api/account/login','/api/account/logout']);
});

test('a late retry response from an old session cannot restore the previous owner',async t=>{
 let resolveRetry,started;const retryPending=new Promise(resolve=>{started=resolve;});
 let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{
  if(++calls===1)throw new TypeError('Failed to fetch');
  if(calls===2){started();return new Promise(resolve=>{resolveRetry=resolve;});}
  return Response.json({user:null});
 });
 const state=createAccountSessionState(productionAccount.session);
 const initial=state.refresh();await retryPending;
 state.beginChange();await state.endChange();
 resolveRetry(ok());await initial;
 assert.deepEqual(state.read(),{state:'signed-out',userId:null});assert.equal(calls,3);
});
