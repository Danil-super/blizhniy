import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createLocalStartupStep} from '../scripts/local-primary-startup.mjs';

test('startup diagnostics correlate bounded stages and preserve acquired handles',async()=>{
 const events=[],step=createLocalStartupStep(event=>events.push(event)),handle={private:'not logged'};
 assert.equal(await step('refunds',async()=>handle),handle);
 await step('proxy',()=>undefined);
 assert.deepEqual(events.map(event=>[event.stage,event.status]),[['refunds','started'],['refunds','completed'],['proxy','started'],['proxy','completed']]);
 assert.equal(new Set(events.map(event=>event.runId)).size,1);
 for(const event of events){
  assert.deepEqual(Object.keys(event).sort(),['elapsedMs','entryPoint','event','pid','runId','stage','status'].sort());
  assert.equal(event.entryPoint,'local-primary');assert.equal(event.event,'local_startup_step');
  assert.equal(event.pid,process.pid);assert.match(event.runId,/^[a-f0-9-]{36}$/);
  assert.ok(Number.isInteger(event.elapsedMs)&&event.elapsedMs>=0);
 }
 const other=[];await createLocalStartupStep(event=>other.push(event))('build',()=>undefined);
 assert.notEqual(events[0].runId,other[0].runId);
 assert.equal(JSON.stringify(events).includes('not logged'),false);
});

test('startup failure records its stage without touching or replacing private exceptions',async()=>{
 const events=[],step=createLocalStartupStep(event=>events.push(event)),error=Object.assign(Error('private password'),{code:'private SQL',toJSON(){throw Error('Must not serialize');}});
 await assert.rejects(step('refunds',()=>{throw error;}),actual=>actual===error);
 assert.deepEqual(events.map(event=>event.status),['started','failed']);
 assert.equal(events[1].stage,'refunds');assert.equal(JSON.stringify(events).includes('private'),false);
});

test('a broken diagnostic sink cannot lose an acquired resource or mask the original failure',async()=>{
 const step=createLocalStartupStep(()=>{throw Error('closed log');}),handle={close(){}};
 assert.equal(await step('application',()=>handle),handle);
 const error=Error('original');await assert.rejects(step('expiry',async()=>{throw error;}),actual=>actual===error);
});

test('unknown stage names are rejected before logging or running the operation',async()=>{
 const events=[],step=createLocalStartupStep(event=>events.push(event));let ran=false;
 await assert.rejects(step('private input',()=>{ran=true;}),{message:'Invalid local startup step'});
 assert.equal(ran,false);assert.deepEqual(events,[]);
});
