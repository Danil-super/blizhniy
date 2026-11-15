import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
const ts=createRequire(import.meta.url)('typescript');
const nodes=value=>value&&typeof value==='object'?[value,...[value.props?.children].flat(Infinity).flatMap(nodes)]:[];
test('page failures provide an accessible retry without rendering private error details or reporting an empty success',()=>{
 const source=readFileSync(new URL('../src/app/error.tsx',import.meta.url),'utf8'),out={};
 assert.match(source,/^["']use client["']/);
 let retries=0;const jsx=(type,props)=>({type,props});
 new Function('require','exports','window',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)(name=>{
  if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};
  if(name==='next/link')return{__esModule:true,default:'link'};
  throw Error('Unexpected error-boundary dependency');
 },out,{location:{reload:()=>retries++}});
 const tree=out.default({error:Error('PRIVATE_DATABASE_PASSWORD_SENTINEL'),reset:()=>{throw Error('A fresh server document is required');}}),all=nodes(tree);
 assert.equal(retries,0);assert.equal(all.filter(node=>node.type==='main').length,1);
 const heading=all.find(node=>node.type==='h1'),alert=all.find(node=>node.props.role==='alert');
 assert.ok(heading);assert.ok(alert);assert.equal(all.find(node=>node.type==='section').props['aria-labelledby'],heading.props.id);
 assert.equal(JSON.stringify(tree).includes('PRIVATE_DATABASE_PASSWORD_SENTINEL'),false);
 assert.equal(JSON.stringify(tree).includes('Ничего не найдено'),false);
 const retry=all.find(node=>node.type==='button');assert.equal(retry.props.type,'button');retry.props.onClick();assert.equal(retries,1);
 assert.ok(all.some(node=>node.type==='link'&&node.props.href==='/'));
});
