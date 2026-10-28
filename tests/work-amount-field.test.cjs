const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const exportsObject={},jsx=(type,props)=>({type,props});
new Function('exports','require',ts.transpileModule(fs.readFileSync('src/components/work/WorkAmountField.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(exportsObject,()=>({jsx,jsxs:jsx}));
const walk=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(walk)];
test('reopened work money preserves exact decimal rubles, never strips cents into whole rubles',()=>{
 for(const kind of ['vacancy','workRequest'])for(const value of ['45000.00','1234.50',null]){
  const input=walk(exportsObject.WorkAmountField({kind,value})).find(node=>node.type==='input');
  assert.equal(input.props.defaultValue,value??'');assert.equal(input.props.name,kind==='vacancy'?'salary':'budget');
  const pattern=new RegExp('^'+input.props.pattern+'$');assert.ok(pattern.test('45000.00'));assert.ok(pattern.test('1234,50'));assert.equal(pattern.test('12.345'),false);
 }
});
