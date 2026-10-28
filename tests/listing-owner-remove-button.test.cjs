const assert=require('node:assert/strict');
const test=require('node:test');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const ts=require('typescript');
function harness(){
 const values=[],effects=[],pending=[],requests=[],changes=[];let cursor=0;
 const react={
  useState(initial){const key=cursor++;if(!(key in values))values[key]=initial;return[values[key],value=>{values[key]=typeof value==='function'?value(values[key]):value;}];},
  useRef(initial){const key=cursor++;if(!(key in values))values[key]={current:initial};return values[key];},
  useEffect(work,deps){const key=cursor++,prior=effects[key];if(!prior||deps.some((value,index)=>value!==prior.deps[index]))pending.push(()=>{prior?.cleanup?.();effects[key]={deps,cleanup:work()};});},
 };
 class RemovalError extends Error{constructor(code){super(code);this.code=code;}}
 const client={remove:(...args)=>new Promise(resolve=>requests.push({args,resolve})),read:async()=>assert.fail('No implicit readback')};
 const exports={},path=resolve(__dirname,'../src/components/listings/ListingOwnerRemoveButton.tsx');
 const code=ts.transpileModule(readFileSync(path,'utf8'),{fileName:path,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','exports',code)(name=>{
  if(name==='react')return react;if(name==='react/jsx-runtime')return require(name);
  if(name==='@/lib/client-listing-owner-removal')return{listingOwnerRemoval:client,ListingOwnerRemovalClientError:RemovalError};
  if(name==='@/lib/local-account')return{notifyAccountSessionChange(){}};
  throw Error('Unexpected removal-button dependency');
 },exports);
 function render(scope){cursor=0;let tree=exports.ListingOwnerRemoveButton({...scope,onChanged:()=>changes.push(scope.owner)});while(pending.length){pending.shift()();cursor=0;tree=exports.ListingOwnerRemoveButton({...scope,onChanged:()=>changes.push(scope.owner)});}return tree;}
 const button=tree=>tree.props.children.flat().find(child=>child?.type==='button');
 return{render,button,requests,changes};
}
test('an aborted owner/id/revision scope cannot leave the next removal button busy or leak its result',async()=>{
 const priorWindow=global.window;global.window={confirm:()=>true};
 try{
  const value=harness(),first={owner:'owner-a',id:'listing-a',revision:'1'},second={owner:'owner-b',id:'listing-b',revision:'2'};
  value.button(value.render(first)).props.onClick();assert.equal(value.button(value.render(first)).props.disabled,true);assert.equal(value.requests.length,1);
  const next=value.button(value.render(second));assert.equal(value.requests[0].args[3].signal.aborted,true);assert.equal(next.props.disabled,false);
  value.requests[0].resolve({removed:true});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(value.changes,[]);
  value.button(value.render(second)).props.onClick();assert.equal(value.requests.length,2);assert.deepEqual(value.requests[1].args.slice(0,3),['owner-b','listing-b','2']);
  value.requests[1].resolve({removed:true});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(value.changes,['owner-b']);
 }finally{if(priorWindow===undefined)delete global.window;else global.window=priorWindow;}
});
