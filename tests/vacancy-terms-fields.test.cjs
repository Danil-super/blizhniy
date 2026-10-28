const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
function load(name){const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/components/work/'+name+'.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(out,key=>{
 if(key==='react/jsx-runtime')return require(key);if(key==='./WorkAmountField')return load('WorkAmountField');throw Error('Unapproved field dependency');
});return out;}
test('vacancy terms share one desktop row and work format/schedule are actual selectable values',()=>{
 const html=renderToStaticMarkup(React.createElement(load('VacancyTermsFields').VacancyTermsFields,{salary:'45000.50',schedule:'5/2',workFormat:'На месте'}));
 assert.match(html,/lg:grid-cols-3/);assert.match(html,/name="salary"[^>]*value="45000.50"/);assert.match(html,/<select name="schedule"/);assert.match(html,/<select name="workFormat"/);
 assert.match(html,/<option value="5\/2" selected="">5\/2/);assert.match(html,/<option value="На месте" selected="">На месте/);assert.match(html,/Удалённо/);
});
test('reopening a previously free-text work format does not silently erase its saved meaning',()=>{
 const html=renderToStaticMarkup(React.createElement(load('VacancyTermsFields').VacancyTermsFields,{schedule:'Неделя через неделю',workFormat:'На объекте заказчика'}));
 assert.match(html,/<option value="Неделя через неделю" selected="">/);assert.match(html,/<option value="На объекте заказчика" selected="">/);
});
