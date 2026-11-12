import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const helper=new URL('../scripts/prepare-ci-browser.sh',import.meta.url);
const yaml=createRequire(import.meta.url)('js-yaml');
function fixture(t,{installExit='0',smokeExit='0'}={}){
 const root=mkdtempSync(join(tmpdir(),'blizhniy-browser-preflight-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const bin=join(root,'bin'),trace=join(root,'trace'),payload=join(root,'payload.js');mkdirSync(bin);
 const stub='#!/usr/bin/python3\nimport os,sys,json\nname=os.path.basename(sys.argv[0])\nwith open(os.environ["TRACE"],"a") as f:f.write(json.dumps([name,*sys.argv[1:]])+"\\n")\nif name=="node":\n with open(os.environ["PAYLOAD"],"w") as f:f.write(sys.stdin.read())\n sys.exit(int(os.environ["SMOKE_EXIT"]))\nsys.exit(int(os.environ["INSTALL_EXIT"]))\n';
 for(const command of ['npx','node'])writeFileSync(join(bin,command),stub,{mode:0o700});
 const result=spawnSync('bash',[fileURLToPath(helper)],{encoding:'utf8',timeout:5000,env:{PATH:bin+':/usr/bin:/bin',TRACE:trace,PAYLOAD:payload,INSTALL_EXIT:installExit,SMOKE_EXIT:smokeExit}});
 const calls=readFileSync(trace,'utf8').trim().split('\n').map(x=>JSON.parse(x));return{root,result,calls,payload};
}
test('browser preparation installs the locked browser and runs mandatory Node preflight without apt or validation bypasses',(t)=>{
 const f=fixture(t);assert.equal(f.result.status,0,f.result.stderr);assert.deepEqual(f.calls,[['npx','playwright','install','chromium'],['node','--input-type=module','-']]);
 assert.doesNotMatch(readFileSync(helper,'utf8'),/sudo|apt-get|PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS|--no-sandbox|ignore-certificate/);
});
test('browser installation failure stops before launch preflight',(t)=>{
 const f=fixture(t,{installExit:'17'});assert.equal(f.result.status,17);assert.deepEqual(f.calls,[['npx','playwright','install','chromium']]);
});
test('browser preflight failure remains a failing shell exit',(t)=>{
 const f=fixture(t,{smokeExit:'19'});assert.equal(f.result.status,19);assert.equal(f.calls.length,2);
});
for(const mode of ['ok','launch-failure','close-failure'])test('actual preflight JavaScript awaits launch/close and propagates '+mode,(t)=>{
 const f=fixture(t),module=join(f.root,'browser.mjs'),marker=join(f.root,'marker');
 writeFileSync(module,"import {appendFileSync} from 'node:fs';export const chromium={async launch(options){if(options.headless!==true)throw new Error('Headless required');appendFileSync(process.env.MARKER,'launch\\n');if(process.env.MODE==='launch-failure')throw new Error('Synthetic missing browser dependency');return{async close(){appendFileSync(process.env.MARKER,'close\\n');if(process.env.MODE==='close-failure')throw new Error('Synthetic close failure');}};}};");
 const source=readFileSync(f.payload,'utf8');assert.equal(source.split("from 'playwright'").length,2);
 const result=spawnSync(process.execPath,['--input-type=module'],{input:source.replace("from 'playwright'",'from '+JSON.stringify(pathToFileURL(module).href)),encoding:'utf8',timeout:5000,env:{MARKER:marker,MODE:mode}});
 assert.equal(result.status,mode==='ok'?0:1,result.stderr);assert.equal(readFileSync(marker,'utf8'),mode==='launch-failure'?'launch\n':'launch\nclose\n');
 if(mode==='ok')assert.match(result.stdout,/Chromium launch preflight passed/);
});
test('all three existing browser callers keep mandatory preflight before unchanged checks',()=>{
 const ci=yaml.load(readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8')),deploy=yaml.load(readFileSync(new URL('../.github/workflows/deploy.yml',import.meta.url),'utf8'));
 const gate=ci.jobs.validate.steps.find(s=>s.name==='Run isolated PostgreSQL 18 integration gate');assert.ok(gate.run.indexOf('bash scripts/prepare-ci-browser.sh')<gate.run.indexOf('docker --host'));assert.equal(gate.if,undefined);assert.equal(gate['continue-on-error'],undefined);
 for(const [job,stepName,nextName] of [[ci.jobs.category_heroes,'Install Chromium for layout checks','Check category heroes before deployment'],[deploy.jobs.postchecks,'Install Chromium','Check deployed category heroes on mobile and desktop']]){
  const step=job.steps.find(s=>s.name===stepName);assert.equal(step.run,'bash scripts/prepare-ci-browser.sh');assert.equal(step.if,undefined);assert.equal(step['continue-on-error'],undefined);assert.ok(job.steps.indexOf(step)<job.steps.findIndex(s=>s.name===nextName));
 }
});
