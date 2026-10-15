import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
const yaml=createRequire(import.meta.url)('js-yaml');
const read=name=>yaml.load(readFileSync(new URL(`../.github/workflows/${name}.yml`,import.meta.url),'utf8'));

test('layout checks run independently while both reusable CI jobs remain mandatory before deployment',()=>{
  const ci=read('ci'),deploy=read('deploy');
  assert.deepEqual(Object.keys(ci.jobs).sort(),['category_heroes','validate']);
  for(const job of Object.values(ci.jobs)){
    assert.equal(job.needs,undefined);assert.equal(job.if,undefined);assert.equal(job['continue-on-error'],undefined);
    assert.equal(job['timeout-minutes'],20);assert.equal(job['runs-on'],'ubuntu-latest');
    for(const step of job.steps){assert.equal(step.if,undefined);assert.equal(step['continue-on-error'],undefined);}
    const guard=job.steps.findIndex(step=>step.name==='Guard quality floor'),install=job.steps.findIndex(step=>step.name==='Install dependencies');
    assert.ok(guard>=0&&guard<install);assert.equal(job.steps[install].run,'npm ci');
  }
  assert.equal(deploy.jobs.validate.uses,'./.github/workflows/ci.yml');
  assert.deepEqual(deploy.jobs.deploy.needs,['validate','security','codeql']);
  assert.equal(deploy.jobs.deploy.if,undefined);
  const scripts=ci.jobs.category_heroes.steps.map(step=>step.run??'').join('\n');
  // Exact pre-change step from e9a979f: commands, readiness loop, env and deadlines are preserved.
  const hero=ci.jobs.category_heroes.steps.find(step=>step.name==='Check category heroes before deployment');
  assert.equal(createHash('sha256').update(JSON.stringify(hero)).digest('hex'),'8f2ac685e5d2258cfc10189aed7727fecb4943da5f12e3909086fcadfbc8cdb2');
  assert.match(scripts,/node scripts\/check-category-heroes\.mjs/);assert.match(scripts,/node scripts\/check-instruments-hero\.mjs/);
  const validation=ci.jobs.validate.steps.map(step=>step.run??'').join('\n');
  for(const command of ['npm run check:types','npm run lint','npm run build','npm audit --omit=dev --audit-level=high',
    'node --experimental-strip-types --test tests/*.test.mjs tests/*.test.cjs scripts/test-*.mjs',
    'bash scripts/test-reconcile-expired-publications.sh','bash scripts/test-deploy-watchdog.sh','bash scripts/test-check-zap-result.sh'])assert.ok(validation.includes(command),command);
});
