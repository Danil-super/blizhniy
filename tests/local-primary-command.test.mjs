import assert from 'node:assert/strict';import {test} from 'node:test';import {spawnSync} from 'node:child_process';

test('local CLI accepts refund opt-in only on start/background and rejects other arguments before fixture access',()=>{
 for(const [args,expected] of [[[],0],[['--prepare','--refunds'],0],[['--start','--other'],0],[['--background','--refunds','extra'],0],[['--start','--refunds'],1],[['--background','--refunds'],1],[['--start'],1]]){
  const script=`
   import assert from 'node:assert/strict';import fs from 'node:fs';import child from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
   let fixture=0;const original=fs.promises.mkdir;fs.promises.mkdir=async(path,...args)=>{if(String(path).includes('/.local/state/blizhniy/')){fixture++;throw Error('Fixture forbidden');}return original(path,...args);};
   child.execFile=()=>{throw Error('Processes forbidden');};globalThis.fetch=()=>{throw Error('Network forbidden');};syncBuiltinESMExports();
   process.argv=['node',process.cwd()+'/scripts/local-primary.mjs',...JSON.parse(process.argv[1])];console.error=()=>{};
   await import('./scripts/local-primary.mjs');await new Promise(resolve=>setTimeout(resolve,20));
   assert.equal(fixture,${expected});assert.equal(process.exitCode,1);process.exitCode=0;console.log('checked');
  `;
  const result=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',script,JSON.stringify(args)],{env:{PATH:process.env.PATH,LANG:'C.UTF-8'},encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'checked');
 }
});
