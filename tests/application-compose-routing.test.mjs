import assert from 'node:assert/strict';import {test} from 'node:test';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript'),jsx=require('react/jsx-runtime'),id='10000000-0000-4000-8000-000000000001';
test('application dispatcher selects cookie composer for anonymous, signed-in and unavailable primary states without mounting old hooks',()=>{
 const source=readFileSync(new URL('../src/components/VacancyApplicationButton.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('application.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='VacancyApplicationButton');assert.ok(fn);
 const code=ts.transpileModule(fn.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 for(const auth of [null,{state:'signed-in',userId:id},{state:'unavailable',userId:null},{state:'signed-out',userId:null}]){
  const exports={};vm.runInNewContext(code,{exports,usePrimaryAccountAuth:()=>auth,PrimaryApplicationComposer:'primary',LegacyVacancyApplicationButton:'legacy',require:name=>{assert.equal(name,'react/jsx-runtime');return jsx;}});
  for(const props of [{vacancyId:id},{targetId:id,targetKind:'workRequest'}]){const result=exports.VacancyApplicationButton(props);assert.equal(result.type,auth?'primary':'legacy');if(auth){assert.equal(result.props.targetId,id);assert.equal(result.props.kind,props.targetKind??'vacancy');}}
 }
});
