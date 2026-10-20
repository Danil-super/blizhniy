import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';
const guardSource=readFileSync(new URL('../scripts/check-quality-floor.mjs',import.meta.url),'utf8');
const pairs=JSON.parse(guardSource.match(/const reviewedListingArtifacts = (\[[\s\S]*?\n\]);/)[1]);
const hash=value=>createHash('sha256').update(value).digest('hex');
for(const pair of pairs)test('reviewed listing test artifact is exact and cannot conceal changes: '+pair.file,t=>{
 const outer=mkdtempSync(join(tmpdir(),'blizhniy-listing-floor-'));t.after(()=>rmSync(outer,{recursive:true,force:true}));
 const repo=join(outer,'repo');mkdirSync(repo);
 const put=(path,value)=>{const target=join(repo,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,value);};
 const git=(...args)=>execFileSync('git',args,{cwd:repo,stdio:'pipe'});
 const before='assert.equal(value, 1);\n',after='assert.equal(value, 2);\n';
 git('init','-q');git('config','user.email','fixture@example.invalid');git('config','user.name','Guard fixture');
 put(pair.file,before);put('tests/foreign.test.mjs','assert.ok(true);\n');git('add','.');git('commit','-qm','owned baseline');
 const patched=guardSource.replace(pair.before,hash(before)).replace(pair.after,hash(after)),candidate=join(outer,'guard.mjs');writeFileSync(candidate,patched);
 const run=()=>spawnSync(process.execPath,[candidate,'--base','HEAD'],{cwd:repo,encoding:'utf8'});
 put(pair.file,after);assert.equal(run().status,0);
 for(const changed of [after+'// unreviewed byte\n','\n',after.replace('assert.equal(value, 2);','assert.ok(true);')]){
  put(pair.file,changed);const result=run();assert.equal(result.status,1,result.stderr);assert.match(result.stderr,/assertion-removed/);
 }
 put(pair.file,after);put('tests/foreign.test.mjs','\n');assert.equal(run().status,1,'approved artifact cannot conceal another deleted assertion');
 put('tests/foreign.test.mjs','assert.ok(true);\n');put(pair.file,'assert.equal(value, 3);\n');git('add','.');git('commit','-qm','different baseline');put(pair.file,after);assert.equal(run().status,1,'an unreviewed before artifact must be rejected');
});

