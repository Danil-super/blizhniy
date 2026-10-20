import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';

function childFixture(scenario) {
 const child=spawn(process.execPath,['--no-warnings','tests/payment-reconciliation-service-process.mjs',scenario],{
  cwd:new URL('../',import.meta.url),env:{PATH:process.env.PATH,LANG:'C.UTF-8'},stdio:['pipe','pipe','pipe'],
 });
 const events=[],watchers=[];let pending='',stderr='',bytes=0;
 const watchdog=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},4000);
 child.stdout.on('data',data=>{
  bytes+=data.length;if(bytes>65536){child.kill('SIGKILL');return;}
  pending+=data.toString();let index;
  while((index=pending.indexOf('\n'))>=0){events.push(JSON.parse(pending.slice(0,index)));pending=pending.slice(index+1);}
  for(const check of [...watchers])check();
 });
 child.stderr.on('data',data=>{stderr+=data.toString();});
 const done=new Promise((resolve,reject)=>{
  child.once('error',error=>{clearTimeout(watchdog);reject(error);});
  child.once('close',(code,signal)=>{clearTimeout(watchdog);resolve({code,signal,stderr});});
 });
 const until=predicate=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{cleanup();reject(Error('Owned child did not reach expected state'));},3000);
  function cleanup(){clearTimeout(timer);const index=watchers.indexOf(check);if(index>=0)watchers.splice(index,1);}
  function check(){const event=events.find(predicate);if(event){cleanup();resolve(event);}}
  watchers.push(check);check();
 });
 return{child,events,until,done,stop:()=>{clearTimeout(watchdog);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}};
}

test('real SIGTERM and SIGINT interrupt the idle timer and naturally exit after one pool close', {timeout:10000},async()=>{
 for(const signal of ['SIGTERM','SIGINT']) {
  const f=childFixture('idle');
  try {
   await f.until(event=>event.status==='tick'&&event.state==='idle');
   assert.equal(f.child.kill(signal),true);
   assert.deepEqual(await Promise.race([f.done,delay(1500).then(()=>{throw Error('Idle service did not stop');})]),{code:0,signal:null,stderr:''});
   assert.equal(f.events.filter(event=>event.fixture==='close').length,1);
   assert.equal(f.events.find(event=>event.fixture==='close').ticks,1);
   assert.equal(f.events.at(-1).status,'stopped');
  }finally{f.stop();}
 }
});

test('real SIGTERM drains the in-flight task, does not close the pool early and does not claim a second job',{timeout:10000},async()=>{
 const f=childFixture('drain');
 try {
  await f.until(event=>event.fixture==='tick');assert.equal(f.child.kill('SIGTERM'),true);
  await delay(30);assert.equal(f.child.exitCode,null);assert.equal(f.events.some(event=>event.fixture==='close'),false);
  f.child.stdin.end('release\n');
  assert.deepEqual(await f.done,{code:0,signal:null,stderr:''});
  assert.equal(f.events.filter(event=>event.fixture==='tick').length,1);
  assert.equal(f.events.filter(event=>event.fixture==='close').length,1);
  assert.deepEqual(f.events.at(-1).outcomes,{completed:1});
 }finally{f.stop();}
});

test('real process fails generically on unknown task outcome or broken stdout without secret leakage',{timeout:10000},async()=>{
 for(const scenario of ['failure','broken-output']) {
  const f=childFixture(scenario);
  try {
   assert.deepEqual(await f.done,{code:1,signal:null,stderr:''});
   assert.equal(f.events.filter(event=>event.fixture==='tick').length,1);
   assert.equal(JSON.stringify(f.events).includes('synthetic-'),false);
   if(scenario==='failure')assert.equal(f.events.at(-1).failureStage,'delivery');
  }finally{f.stop();}
 }
});
