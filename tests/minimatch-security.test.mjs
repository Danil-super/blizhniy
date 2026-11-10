import assert from 'node:assert/strict';import {test} from 'node:test';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url),consumer=createRequire(require.resolve('@typescript-eslint/typescript-estree')),entry=consumer.resolve('minimatch');
test('the real TypeScript ESLint dependency bounds level-two glob amplification and pairwise optimization',()=>{
 const script=`const assert=require('node:assert/strict'),{Minimatch}=require(process.argv[1]);
 const amplified=new Minimatch(Array(8).fill('**/../a/b').join('/'),{optimizationLevel:2,braceExpandMax:16});
 assert.ok(amplified.set.length<=16,'Glob expansion exceeded the explicit budget');
 const small=new Minimatch('{x,*}/{0..9}',{optimizationLevel:2});assert.equal(small.set.length,10);
 const large=new Minimatch('{x,*}/{0..999}',{optimizationLevel:2});assert.equal(large.set.length,2000);
 assert.equal(large.match('x/5'),true);assert.equal(large.match('y/999'),true);assert.equal(large.match('.y/5'),false);`;
 execFileSync(process.execPath,['--max-old-space-size=128','-e',script,entry],{timeout:8000,stdio:'pipe',env:{PATH:process.env.PATH,LANG:'C.UTF-8'}});
});
test('the consumer keeps CommonJS minimatch syntax for its actual dot-aware allowDefaultProject checks',()=>{
 const {minimatch}=consumer('minimatch');for(const [file,pattern,result] of [['config.ts','*.ts',true],['.config.ts','*.ts',true],['src/config.ts','*.ts',false],['src/config.ts','src/*.ts',true],['src/config.js','src/*.ts',false]])assert.equal(minimatch(file,pattern,{dot:true}),result);
});

test('the real parser project service obtains types for dot-prefixed out-of-project files with the scoped matcher',()=>{
 const root=mkdtempSync(join(tmpdir(),'blizhniy-eslint-glob-'));
 try{mkdirSync(join(root,'src'));writeFileSync(join(root,'src','included.ts'),'export const value = 1;');writeFileSync(join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true},include:['src/**/*.ts']}));
  const source='export const answer: number = 42;',file=join(root,'.config.ts');writeFileSync(file,source);
  const parser=require('@typescript-eslint/parser'),result=parser.parseForESLint(source,{filePath:file,tsconfigRootDir:root,projectService:{allowDefaultProject:['*.ts']},sourceType:'module'});
  assert.equal(result.services.program.getSourceFile(file).text,source);assert.equal(result.ast.body[0].type,'ExportNamedDeclaration');assert.ok(result.services.esTreeNodeToTSNodeMap.has(result.ast.body[0]));
 }finally{rmSync(root,{recursive:true,force:true});}
});
