import assert from 'node:assert/strict';import {test} from 'node:test';import {createRequire} from 'node:module';import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url),yaml=require('js-yaml'),image='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const ci=yaml.load(readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8')),deploy=yaml.load(readFileSync(new URL('../.github/workflows/deploy.yml',import.meta.url),'utf8'));
const suites=[
 'postgres-integration.mjs',
 'bootstrap-postgres-integration.mjs',
 'telegram-phone-postgres-integration.mjs',
 'account-deletion-postgres-integration.mjs',
 'profession-catalog-postgres-integration.mjs',
 'primary-search-postgres-integration.mjs',
 'booking-lifecycle-postgres.mjs',
 'payment-reconciliation-deletion-postgres.mjs',
 'placement-refund-approval-postgres.mjs',
 'application-compensation-cases-postgres.mjs',
 'work-owner-actions-postgres.mjs',
 'response-checkout-fence-postgres.mjs',
 'checkout-cancellation-postgres.mjs',
 'publication-test-postgres.mjs',
 'publication-test-release-postgres.mjs',
 'approved-account-export-postgres.mjs',
 'specialist-checkout-postgres.mjs',
 'specialist-checkout-guards-postgres.mjs',
 'admin-user-access-postgres-integration.mjs',
 'admin-tariff-postgres-integration.mjs',
 'logical-backup-restore-postgres.mjs',
 'basic-erasure-restore-postgres.mjs',
];
test('real PostgreSQL is a mandatory gate before packaging and is inherited by deployment',()=>{
 assert.ok(ci.on.workflow_call);assert.deepEqual(ci.on.pull_request.branches,['main']);assert.ok(Object.hasOwn(ci.on,'workflow_dispatch'));
 assert.deepEqual(ci.permissions,{contents:'read'});
 const job=ci.jobs.validate,step=job.steps.find(s=>s.name==='Run isolated PostgreSQL 18 integration gate');assert.ok(step);assert.equal(step.if,undefined);assert.equal(step['continue-on-error'],undefined);assert.equal(step.env,undefined);
 assert.equal(job.if,undefined);assert.equal(job['continue-on-error'],undefined);assert.equal(job['runs-on'],'ubuntu-24.04');assert.equal(job['timeout-minutes'],25);
 assert.ok(job.steps.indexOf(step)>job.steps.findIndex(s=>s.name==='Install dependencies'));assert.ok(job.steps.indexOf(step)<job.steps.findIndex(s=>s.name==='Build the production artifact on GitHub'));assert.ok(job.steps.indexOf(step)<job.steps.findIndex(s=>s.name==='Upload the verified production artifact'));
 assert.equal(deploy.jobs.validate.uses,'./.github/workflows/ci.yml');assert.ok(deploy.jobs.deploy.needs.includes('validate'));assert.equal(deploy.jobs.deploy.if,undefined);
 assert.match(step.run,/^set -euo pipefail\n/);for(const file of suites)assert.ok(readFileSync(new URL('./'+file,import.meta.url),'utf8').includes(image),file+' must use the pinned PG18 image');
});
test('the exact CI shell pulls only the pinned image and executes every suite serially without swallowed failures',()=>{
 const step=ci.jobs.validate.steps.find(s=>s.name==='Run isolated PostgreSQL 18 integration gate');assert.ok(step);const directory=mkdtempSync(join(tmpdir(),'blizhniy-ci-argv-'));
 try{
  const output=join(directory,'argv.jsonl'),stub='#!/usr/bin/python3\nimport sys,json,os\nwith open(os.environ["ARGV_OUTPUT"],"a") as f:f.write(json.dumps([os.path.basename(sys.argv[0]),*sys.argv[1:]])+"\\n")\nif os.path.basename(sys.argv[0])=="node":sys.exit(int(os.environ.get("NODE_EXIT" if "--test" in sys.argv else "PREFLIGHT_EXIT","0")))\nif os.path.basename(sys.argv[0])=="docker":sys.exit(int(os.environ.get("DOCKER_EXIT","0")))\nif os.path.basename(sys.argv[0])=="npx":sys.exit(int(os.environ.get("BROWSER_EXIT","0")))\n';
  for(const command of ['docker','node','npx'])writeFileSync(join(directory,command),stub,{mode:0o700});const env={PATH:directory+':/usr/bin:/bin',LANG:'C.UTF-8',ARGV_OUTPUT:output};
  execFileSync('bash',['-c',step.run],{env,timeout:5000,stdio:'pipe'});const calls=readFileSync(output,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(calls,[['npx','playwright','install','chromium'],['node','--input-type=module','-'],['docker','--host','unix:///var/run/docker.sock','pull',image],...suites.map(file=>['node','--experimental-strip-types','--test','--test-concurrency=1','tests/'+file])]);
  assert.throws(()=>execFileSync('bash',['-c',step.run],{env:{...env,NODE_EXIT:'17'},timeout:5000,stdio:'pipe'}),error=>error.status===17);
  assert.throws(()=>execFileSync('bash',['-c',step.run],{env:{...env,PREFLIGHT_EXIT:'23'},timeout:5000,stdio:'pipe'}),error=>error.status===23);
  assert.throws(()=>execFileSync('bash',['-c',step.run],{env:{...env,DOCKER_EXIT:'19'},timeout:5000,stdio:'pipe'}),error=>error.status===19);
  assert.throws(()=>execFileSync('bash',['-c',step.run],{env:{...env,BROWSER_EXIT:'21'},timeout:5000,stdio:'pipe'}),error=>error.status===21);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
