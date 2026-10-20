import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

test('worker CLI import installs no process handlers; only explicit check/run are admitted and errors contain no environment secrets',async()=>{
 const before=['SIGTERM','SIGINT'].map(name=>process.listenerCount(name));
 await import('../scripts/payment-worker.mjs');
 assert.deepEqual(['SIGTERM','SIGINT'].map(name=>process.listenerCount(name)),before);
 const script=fileURLToPath(new URL('../scripts/payment-worker.mjs',import.meta.url));
 for(const args of [[],['--plan'],['--run','extra'],['--check'],['--run']]){
  const result=spawnSync(process.execPath,[script,...args],{env:{PATH:process.env.PATH,BLIZHNIY_PAYMENT_SECRET_KEY:'synthetic-private-secret'},encoding:'utf8',timeout:10000});
  assert.equal(result.status,1,result.stderr);
  assert.equal(result.stderr,'');
  const event=JSON.parse(result.stdout);
  assert.equal(event.status,'unavailable');assert.equal(event.failureStage,'configuration');
  assert.equal(result.stdout.includes('synthetic-private-secret'),false);
 }
});
