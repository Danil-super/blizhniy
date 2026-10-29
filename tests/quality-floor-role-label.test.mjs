import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

test('reviewed role-label replacement permits only the exact assertion pair in the exact file',t=>{
 const root=mkdtempSync(join(tmpdir(),'blizhniy-role-floor-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const guard=resolve('scripts/check-quality-floor.mjs'),file='tests/registration-web-integration.mjs';
 const before='        assert.equal(await page.getByText(/Администратор · права проверяет сервер/).count(), 0);';
 const after='        assert.equal(await page.getByText("Администратор", { exact: true }).count(), 0);';
 const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 const put=(path,value)=>writeFileSync(join(root,path),value);
 mkdirSync(join(root,'tests'));git('init','-q');git('config','user.email','fixture@example.invalid');git('config','user.name','Guard fixture');
 put(file,before+'\n');put('tests/other.test.mjs','assert.ok(true);\n');git('add','.');git('commit','-qm','owned baseline');
 const run=()=>spawnSync(process.execPath,[guard,'--base','HEAD'],{cwd:root,encoding:'utf8'});
 put(file,after+'\n');assert.equal(run().status,0);
 for(const text of [after.replace('exact: true','exact: false'),after.replace('.count(), 0','.count(), 1'),'']){
  put(file,text+'\n');assert.equal(run().status,1);
 }
 put(file,after+'\n');put('tests/other.test.mjs','\n');assert.equal(run().status,1);
 put('tests/other.test.mjs',before+'\n');git('add','tests/other.test.mjs');git('commit','-qm','different test');
 put('tests/other.test.mjs',after+'\n');assert.equal(run().status,1);
});
