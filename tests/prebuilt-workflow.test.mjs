import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url),yaml=require('js-yaml');
const workflow=()=>yaml.load(readFileSync('.github/workflows/deploy.yml','utf8'));
test('production artifact is built and exercised on a compatible runner before SSH secrets become available',()=>{
 const jobs=workflow().jobs,deploy=jobs.deploy,ci=yaml.load(readFileSync('.github/workflows/ci.yml','utf8'));
 assert.equal(ci.jobs.validate['runs-on'],'ubuntu-24.04');assert.deepEqual(deploy.needs,['validate','security','codeql']);
 const steps=ci.jobs.validate.steps,build=steps.findIndex(s=>s.name==='Build the production artifact on GitHub'),pack=steps.findIndex(s=>s.id==='package');
 assert.ok(build>0&&build<pack);
 assert.equal(steps[build].env.BLIZHNIY_BUILD_COMMIT,'${{ github.sha }}');
 assert.equal(steps[build].env.__NEXT_PROCESSED_ENV,'true');
 assert.match(steps[pack].run,/scripts\/check-prebuilt-runtime\.mjs/);
 assert.match(steps[pack].run,/scripts\/verify-prebuilt-release\.mjs/);
 assert.doesNotMatch(JSON.stringify(ci),/secrets\./);
 assert.doesNotMatch(JSON.stringify(jobs.postchecks),/secrets\./);
 assert.equal(jobs.validate.with.publish_release,true);
 assert.equal(steps.find(s=>s.name==='Upload the verified production artifact').if,'${{ inputs.publish_release }}');
 const download=deploy.steps.find(s=>s.name==='Download the verified production artifact');
 assert.equal(download.with.name,'${{ needs.validate.outputs.artifact_name }}');
 assert.equal(ci.on.workflow_call.outputs.artifact_name.value,'${{ jobs.validate.outputs.artifact_name }}');
 const ship=deploy.steps.find(s=>s.id==='ship');
 assert.equal(ship.env.RELEASE_ARCHIVE_SHA256,'${{ needs.validate.outputs.archive_sha256 }}');
 assert.match(ship.run,/export PREBUILT_RELEASE=true/);
 assert.match(ship.run,/export SOURCE_ARCHIVE_SHA256=/);
 assert.match(jobs.finalize.if,/always\(\)/);
 assert.deepEqual(jobs.finalize.needs,['deploy','postchecks']);
 assert.doesNotMatch(JSON.stringify(jobs.finalize),/npm ci/);
 assert.doesNotMatch(JSON.stringify(deploy),/npm ci|npm run build/);
});
test('a corrupted transport archive cannot execute its installer or create an extracted source tree',()=>{
 for(const checksum of ['0'.repeat(64),'']){
  const root=mkdtempSync(join(tmpdir(),'prebuilt-wrapper-integrity-'));
  try{
   const stage=join(root,'stage'),input=join(root,'input');mkdirSync(stage,{mode:0o700});mkdirSync(join(input,'scripts'),{recursive:true});
   writeFileSync(join(input,'scripts/deploy-release.sh'),'touch "$UNEXPECTED_EXECUTION"\n');
   const archive=join(stage,'release.tar.gz');assert.equal(spawnSync('tar',['-czf',archive,'-C',input,'.']).status,0);
   const ship=workflow().jobs.deploy.steps.find(s=>s.id==='ship');
   const wrapper=ship.run.match(/cat > "\$LOCAL_SCRIPT" <<'EOF'\n([\s\S]*?)\n\s*EOF/)[1];
   const marker=join(root,'unexpected');const result=spawnSync('bash',['-c',wrapper],{encoding:'utf8',env:{...process.env,
    REMOTE_DIR:stage,SOURCE_ARCHIVE:archive,SOURCE_ARCHIVE_SHA256:checksum,UNEXPECTED_EXECUTION:marker}});
   assert.notEqual(result.status,0);assert.equal(existsSync(marker),false);assert.equal(existsSync(join(stage,'source')),false);
  }finally{rmSync(root,{recursive:true,force:true});}
 }
});
