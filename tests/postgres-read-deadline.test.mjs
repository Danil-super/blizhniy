import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PostgresDatabase,PostgresError} from '../src/lib/postgres.ts';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function bounded(promise){
 let timeout;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Read deadline test did not settle')),2000);})]);}
 finally{clearTimeout(timeout);}
}
function fakePool({holdAcquire=false,onQuery}={}){
 const calls=[],releases=[],events=[];let callback,pending;
 const client={
  query:async config=>{
   calls.push(config);events.push('query:'+config.text);
   const result=onQuery?onQuery(config):{rows:[{value:42}],rowCount:1};
   if(!Number.isInteger(config.query_timeout)||config.query_timeout<1)return result;
   // Model pg's real query_timeout callback, not an indefinitely stalled fake driver.
   let timer;
   try{return await Promise.race([Promise.resolve(result),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Query read timeout')),config.query_timeout);})]);}
   finally{clearTimeout(timer);}
  },
  release:error=>{releases.push(error);events.push('release');},
 };
 const pool={on(){},connect(done){
  events.push('acquire');callback=done;pending=deferred();
  if(!holdAcquire)queueMicrotask(()=>settle());
  return typeof done==='function'?undefined:pending.promise;
 }};
 function settle(error){
  assert.ok(pending,'a pool acquisition must exist before settling');
  if(typeof callback==='function')callback(error??null,error?undefined:client);
  else if(error)pending.reject(error);else pending.resolve(client);
 }
 return{db:new PostgresDatabase(pool),calls,releases,events,settle};
}
function safeDriverError(error){
 assert.ok(error instanceof PostgresError);assert.equal(error.message,'PostgreSQL operation failed');assert.equal(error.message.includes('PRIVATE-DRIVER-SENTINEL'),false);return true;
}
function noRollback(f){assert.equal(f.calls.some(call=>/^ROLLBACK\b/i.test(call.text)),false,'a poisoned read connection must be destroyed, not queued behind a possibly running statement');}

for(const timeoutMs of [undefined,null,0,-1,1.5,5001,'100',NaN,Infinity]){
 test(`read transaction rejects invalid budget ${String(timeoutMs)} before acquiring a connection`,async()=>{
  const f=fakePool(),options={timeoutMs};let completed=0;
  await assert.rejects(()=>f.db.readTransaction(async()=>assert.fail('invalid input must not run work'),{...options,onComplete:()=>completed++}));
  assert.deepEqual(f.events,[]);assert.deepEqual(f.calls,[]);assert.deepEqual(f.releases,[]);
  assert.equal(completed,0,'no admitted work exists for invalid options');
 });
}

test('successful bounded read uses repeatable read/read-only, server timeouts and extended protocol before one normal release',async()=>{
 const f=fakePool();let complete=0;
 const value=await f.db.readTransaction(async tx=>(await tx.query('SELECT $1::text',['literal SQL-looking value; --'])).rows[0].value,
  {timeoutMs:1000,onComplete:()=>{complete++;f.events.push('complete');assert.equal(f.releases.length,1);}});
 assert.equal(value,42);assert.equal(complete,1);assert.equal(f.releases.length,1);assert.notEqual(f.releases[0],true);
 assert.match(f.calls[0].text,/^BEGIN\b.*ISOLATION LEVEL REPEATABLE READ.*READ ONLY/i);
 assert.equal(f.calls.at(-1).text,'COMMIT');
 for(const call of f.calls){assert.equal(call.queryMode,'extended');assert.ok(Number.isInteger(call.query_timeout)&&call.query_timeout>0&&call.query_timeout<=1000);}
 const settings=f.calls.filter(call=>call.text.includes('set_config'));
 assert.ok(settings.some(call=>call.text.includes('statement_timeout')));assert.ok(settings.some(call=>call.text.includes('transaction_timeout')));
 assert.ok(f.calls.some(call=>call.text==='SELECT $1::text'&&call.values[0]==='literal SQL-looking value; --'));
 assert.deepEqual(f.events.slice(-2),['release','complete']);
});

test('a later query receives the remaining global read budget rather than a fresh timeout',async()=>{
 const f=fakePool({onQuery:async config=>{if(config.text==='SELECT first')await delay(25);return{rows:[],rowCount:0};}});
 await f.db.readTransaction(async tx=>{await tx.query('SELECT first');await tx.query('SELECT second');},{timeoutMs:1000});
 const first=f.calls.find(call=>call.text==='SELECT first'),second=f.calls.find(call=>call.text==='SELECT second');
 assert.ok(first);assert.ok(second);assert.ok(second.query_timeout<first.query_timeout,'per-query timeout must decrease after elapsed work');
 assert.ok(second.query_timeout>0);assert.equal(f.releases.length,1);
});

test('acquisition deadline rejects promptly but retains admission until the late client is destroyed without SQL',async()=>{
 const f=fakePool({holdAcquire:true});let complete=0,ran=false;
 const pending=f.db.readTransaction(async()=>{ran=true;},{timeoutMs:30,onComplete:()=>complete++});
 await bounded(assert.rejects(pending));
 assert.equal(ran,false);assert.equal(complete,0,'pool acquisition still owns its admission slot');assert.deepEqual(f.calls,[]);assert.deepEqual(f.releases,[]);
 f.settle();await tick();assert.deepEqual(f.releases,[true]);assert.equal(complete,1);assert.deepEqual(f.calls,[]);assert.equal(ran,false);
 await tick();assert.equal(complete,1);assert.equal(f.releases.length,1);
});

test('late acquisition failure releases admission exactly once and never starts transaction work',async()=>{
 const f=fakePool({holdAcquire:true});let complete=0;
 const pending=f.db.readTransaction(async()=>assert.fail('expired acquisition must not run work'),{timeoutMs:30,onComplete:()=>complete++});
 await bounded(assert.rejects(pending));assert.equal(complete,0);
 f.settle(Error('PRIVATE-DRIVER-SENTINEL late acquisition error'));await tick();
 assert.equal(complete,1);assert.deepEqual(f.calls,[]);assert.deepEqual(f.releases,[]);
});

test('immediate pool failure is sanitized and releases admission without a client or SQL',async()=>{
 const f=fakePool({holdAcquire:true});let complete=0;
 const pending=f.db.readTransaction(async()=>assert.fail('failed acquisition must not run work'),{timeoutMs:1000,onComplete:()=>complete++});
 f.settle(Error('PRIVATE-DRIVER-SENTINEL pool failure'));
 await assert.rejects(pending,safeDriverError);assert.equal(complete,1);assert.deepEqual(f.calls,[]);assert.deepEqual(f.releases,[]);
});

test('driver read timeout immediately destroys the connection without queued rollback or unsafe pool reuse',async()=>{
 const f=fakePool({onQuery:async config=>{
  if(config.text==='SELECT stalled')throw Error('Query read timeout');return{rows:[],rowCount:0};
 }});let complete=0;
 await assert.rejects(f.db.readTransaction(tx=>tx.query('SELECT stalled'),{timeoutMs:1000,onComplete:()=>{complete++;assert.deepEqual(f.releases,[true]);}}),safeDriverError);
 assert.deepEqual(f.releases,[true]);assert.equal(complete,1);noRollback(f);
 assert.equal(f.calls.some(call=>call.text==='COMMIT'),false);
});

test('arbitrary work failure destroys its read transaction and preserves the caller error',async()=>{
 const f=fakePool(),failure=Error('Synthetic caller failure');let complete=0;
 await assert.rejects(f.db.readTransaction(async()=>{throw failure;},{timeoutMs:1000,onComplete:()=>complete++}),error=>error===failure);
 assert.deepEqual(f.releases,[true]);assert.equal(complete,1);noRollback(f);assert.equal(f.calls.some(call=>call.text==='COMMIT'),false);
});

test('global deadline destroys a held query and late completion cannot commit or release twice',async()=>{
 const hold=deferred(),entered=deferred(),f=fakePool({onQuery:async config=>{
  if(config.text==='SELECT held'){entered.resolve();return hold.promise;}return{rows:[],rowCount:0};
 }});let complete=0;
 const pending=f.db.readTransaction(tx=>tx.query('SELECT held'),{timeoutMs:100,onComplete:()=>complete++});
 await bounded(entered.promise);await bounded(assert.rejects(pending));
 assert.deepEqual(f.releases,[true]);assert.equal(complete,1);noRollback(f);
 hold.resolve({rows:[{value:1}],rowCount:1});await tick();await tick();
 assert.equal(f.calls.some(call=>call.text==='COMMIT'),false);assert.equal(complete,1);assert.equal(f.releases.length,1);
});

test('work resumed after the deadline cannot issue another query on the destroyed read connection',async()=>{
 const hold=deferred(),entered=deferred(),f=fakePool();let complete=0;
 const pending=f.db.readTransaction(async tx=>{entered.resolve();await hold.promise;await tx.query('SELECT too_late');},{timeoutMs:100,onComplete:()=>complete++});
 await bounded(entered.promise);await bounded(assert.rejects(pending));assert.deepEqual(f.releases,[true]);assert.equal(complete,1);
 hold.resolve();await tick();await tick();
 assert.equal(f.calls.some(call=>call.text==='SELECT too_late'||call.text==='COMMIT'),false);assert.equal(f.releases.length,1);assert.equal(complete,1);noRollback(f);
});

test('COMMIT is covered by the same global deadline and a late acknowledgement cannot return its connection to the pool',async()=>{
 const commit=deferred(),entered=deferred(),f=fakePool({onQuery:async config=>{
  if(config.text==='COMMIT'){entered.resolve();return commit.promise;}return{rows:[{value:42}],rowCount:1};
 }});let complete=0;
 const pending=f.db.readTransaction(async()=>42,{timeoutMs:100,onComplete:()=>complete++});
 await bounded(entered.promise);await bounded(assert.rejects(pending));assert.deepEqual(f.releases,[true]);assert.equal(complete,1);noRollback(f);
 const config=f.calls.find(call=>call.text==='COMMIT');assert.ok(config.query_timeout>0&&config.query_timeout<=100);
 commit.resolve({rows:[],rowCount:0});await tick();await tick();assert.deepEqual(f.releases,[true]);assert.equal(complete,1);
});

test('a read transaction handle cannot execute SQL after successful commit and physical release',async()=>{
 const f=fakePool();let saved,complete=0;
 const result=await f.db.readTransaction(async tx=>{saved=tx;return 42;},{timeoutMs:1000,onComplete:()=>complete++});
 assert.equal(result,42);assert.equal(complete,1);assert.deepEqual(f.releases,[false]);
 const before=f.calls.length;
 await assert.rejects(saved.query('SELECT escaped_after_commit'));
 assert.equal(f.calls.length,before,'a completed read handle must not send another query to a released connection');
 assert.equal(f.calls.some(call=>call.text==='SELECT escaped_after_commit'),false);
 assert.equal(complete,1);assert.deepEqual(f.releases,[false]);
});

test('a read transaction handle cannot execute SQL after work failure and destroyed release',async()=>{
 const f=fakePool(),failure=Error('Synthetic work failure before escaped read');let saved,complete=0;
 await assert.rejects(f.db.readTransaction(async tx=>{saved=tx;throw failure;},{timeoutMs:1000,onComplete:()=>complete++}),error=>error===failure);
 assert.equal(complete,1);assert.deepEqual(f.releases,[true]);const before=f.calls.length;
 await assert.rejects(saved.query('SELECT escaped_after_failure'));
 assert.equal(f.calls.length,before,'a failed read handle must not send SQL after its lease completes');
 assert.equal(f.calls.some(call=>call.text==='SELECT escaped_after_failure'),false);
 assert.equal(complete,1);assert.deepEqual(f.releases,[true]);noRollback(f);
});

test('a detached asynchronous continuation cannot use a read handle after its lease completes',async()=>{
 const f=fakePool(),resume=deferred();let detached,complete=0;
 assert.equal(await f.db.readTransaction(async tx=>{
  detached=resume.promise.then(()=>tx.query('SELECT detached_after_complete'));
  return'public result';
 },{timeoutMs:1000,onComplete:()=>complete++}),'public result');
 assert.equal(complete,1);assert.deepEqual(f.releases,[false]);const before=f.calls.length;
 const denied=assert.rejects(detached);resume.resolve();await bounded(denied);
 assert.equal(f.calls.length,before);assert.equal(f.calls.some(call=>call.text==='SELECT detached_after_complete'),false);
 assert.equal(complete,1);assert.deepEqual(f.releases,[false]);
});

for(const deadline of [null,-1,'100',NaN,Infinity])test(`read transaction rejects invalid absolute deadline ${String(deadline)} before pool checkout`,async()=>{
 const f=fakePool();let complete=0;
 await assert.rejects(f.db.readTransaction(async()=>assert.fail('invalid deadline'),{timeoutMs:1000,deadline,onComplete:()=>complete++}));
 assert.deepEqual(f.events,[]);assert.equal(complete,0);
});

test('an already expired absolute deadline releases admission without even acquiring a connection',async()=>{
 const f=fakePool();let complete=0;
 await assert.rejects(f.db.readTransaction(async()=>assert.fail('expired deadline'),{timeoutMs:1000,deadline:performance.now()-1,onComplete:()=>complete++}),{code:'ETIMEDOUT'});
 assert.deepEqual(f.events,[]);assert.equal(complete,1);
});

test('an earlier absolute deadline shortens the SQL budget and is never reset at the database boundary',async()=>{
 const f=fakePool();
 await f.db.readTransaction(tx=>tx.query('SELECT bounded_absolute'),{timeoutMs:1000,deadline:performance.now()+100});
 assert.ok(f.calls.length>0);assert.ok(f.calls.every(call=>call.query_timeout<=100));assert.equal(f.releases.length,1);
});

test('a delayed acquisition callback checks the absolute clock before issuing BEGIN even if the timer has not run',async t=>{
 let now=1000; t.mock.method(performance,'now',()=>now);
 const f=fakePool({holdAcquire:true});let complete=0;
 const pending=f.db.readTransaction(async()=>assert.fail('late acquisition ran work'),{timeoutMs:1000,deadline:1100,onComplete:()=>complete++});
 now=1100;f.settle();await assert.rejects(pending,{code:'ETIMEDOUT'});
 assert.deepEqual(f.calls,[]);assert.deepEqual(f.releases,[true]);assert.equal(complete,1);
});
