import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const yaml=createRequire(import.meta.url)('js-yaml');
const source=readFileSync(new URL('../scripts/prepare-ci-apt-mirrors.sh',import.meta.url),'utf8');
const mirrors='https://archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://security.ubuntu.com/ubuntu/\tpriority:2\n';
function fixture(t,{env={},missing=false,sudoExit='0'}={}){
 const root=mkdtempSync(join(tmpdir(),'blizhniy-apt-mirrors-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const mirror=join(root,'mirrors.txt'),trace=join(root,'trace'),script=join(root,'helper.sh'),bin=join(root,'bin');mkdirSync(bin);
 const original='http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n';if(!missing)writeFileSync(mirror,original);
 assert.equal(source.split('mirror_list=/etc/apt/apt-mirrors.txt').length,2);
 writeFileSync(script,source.replace('mirror_list=/etc/apt/apt-mirrors.txt','mirror_list="$FIXTURE_MIRROR"'));
 writeFileSync(join(bin,'sudo'),'#!/usr/bin/python3\nimport sys,os\nassert sys.argv[1:]==["tee",os.environ["FIXTURE_MIRROR"]]\nwith open(os.environ["FIXTURE_TRACE"],"w") as f:f.write("sudo tee")\nstatus=int(os.environ["FIXTURE_SUDO_EXIT"])\nif status:sys.exit(status)\nwith open(os.environ["FIXTURE_MIRROR"],"w") as f:f.write(sys.stdin.read())\n',{mode:0o700});
 const result=spawnSync('bash',[script],{encoding:'utf8',timeout:5000,env:{PATH:bin+':/usr/bin:/bin',GITHUB_ACTIONS:'true',RUNNER_OS:'Linux',RUNNER_ARCH:'X64',RUNNER_ENVIRONMENT:'github-hosted',FIXTURE_MIRROR:mirror,FIXTURE_TRACE:trace,FIXTURE_SUDO_EXIT:sudoExit,...env}});
 return{result,mirror,trace,original};
}
test('runner helper replaces only its mirror list with two prioritized official HTTPS archives',(t)=>{
 const f=fixture(t);assert.equal(f.result.status,0,f.result.stderr);assert.equal(readFileSync(f.mirror,'utf8'),mirrors);assert.equal(readFileSync(f.trace,'utf8'),'sudo tee');
});
for(const [name,env] of [['outside Actions',{GITHUB_ACTIONS:''}],['non-Linux',{RUNNER_OS:'Windows'}],['non-x64',{RUNNER_ARCH:'ARM64'}],['self-hosted',{RUNNER_ENVIRONMENT:'self-hosted'}]]){
 test('runner helper refuses '+name+' before any privileged write',(t)=>{
  const f=fixture(t,{env});assert.equal(f.result.status,1);assert.equal(readFileSync(f.mirror,'utf8'),f.original);assert.throws(()=>readFileSync(f.trace),{code:'ENOENT'});
 });
}
test('missing expected runner mirror list fails before sudo',(t)=>{
 const f=fixture(t,{missing:true});assert.equal(f.result.status,1);assert.throws(()=>readFileSync(f.trace),{code:'ENOENT'});
});
test('privileged write failure is preserved, never converted to success',(t)=>{
 const f=fixture(t,{sudoExit:'17'});assert.equal(f.result.status,17);assert.equal(readFileSync(f.mirror,'utf8'),f.original);
});
test('all three browser callers prepare mirrors before apt/browser setup without changing existing gates',()=>{
 const ci=yaml.load(readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8')),deploy=yaml.load(readFileSync(new URL('../.github/workflows/deploy.yml',import.meta.url),'utf8'));
 for(const [job,before] of [[ci.jobs.validate,'Prepare OpenSSH regression prerequisites'],[ci.jobs.category_heroes,'Install Chromium for layout checks'],[deploy.jobs.postchecks,'Install Chromium']]){
  const matches=job.steps.filter(s=>s.name==='Prepare Ubuntu package mirrors');assert.equal(matches.length,1);const step=matches[0];assert.equal(step.run,'bash scripts/prepare-ci-apt-mirrors.sh');assert.equal(step.if,undefined);assert.equal(step['continue-on-error'],undefined);
  assert.ok(job.steps.indexOf(step)<job.steps.findIndex(s=>s.name===before));
 }
 assert.equal(ci.jobs.category_heroes.steps.find(s=>s.name==='Install Chromium for layout checks').run,'npx playwright install --with-deps chromium');
 assert.equal(deploy.jobs.postchecks.steps.find(s=>s.name==='Install Chromium').run,'npx playwright install --with-deps chromium');
 assert.match(ci.jobs.validate.steps.find(s=>s.name==='Run isolated PostgreSQL 18 integration gate').run,/npx playwright install --with-deps chromium/);
});
