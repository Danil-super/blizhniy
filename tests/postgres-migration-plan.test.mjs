import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

test('read-only migration manifest loads in plain Node without TypeScript, pg, operator credentials or startup',async()=>{
 const url=new URL('../scripts/postgres-migration-plan.mjs',import.meta.url);
 const result=spawnSync(process.execPath,['--input-type=module','-e',`const {getBootstrapPlan}=await import(${JSON.stringify(url.href)}); console.log(JSON.stringify(getBootstrapPlan({includePaymentReconciliationRole:true})));`],{
  env:{PATH:process.env.PATH,PGHOST:'must-not-connect.example.invalid'},encoding:'utf8',timeout:10000,
 });
 assert.equal(result.status,0,result.stderr);
 const plan=JSON.parse(result.stdout);
 assert.equal(plan.length,24);
 for(const row of plan){
  const sql=readFileSync(new URL(`../database/migrations/${row.name}`,import.meta.url),'utf8');
  assert.equal(row.sha256,createHash('sha256').update(sql).digest('hex'));
  assert.equal(row.sql,sql.replace(/^begin;\r?\n/m,'').replace(/commit;\s*$/,''));
 }
 const {getBootstrapPlan}=await import(url);
 assert.equal(getBootstrapPlan().length,7);
 assert.throws(()=>getBootstrapPlan({includePaymentReconciliationRole:'true'}),/Invalid/);
 const source=readFileSync(url,'utf8');
 assert.doesNotMatch(source,/from ['"](?:pg|.*bootstrap-postgres|.*\.ts)['"]|process\.env|process\.argv|\.query\(/);
});
