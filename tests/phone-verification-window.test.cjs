const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),ts=require('typescript');
const exportsForTest={};
new Function('exports',ts.transpileModule(fs.readFileSync('src/lib/phone-verification-window.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exportsForTest);
const popup=()=>({closed:0,close(){this.closed++;}});
test('pending phone window survives form remounts without browser storage',()=>{
 const memory=exportsForTest.createPhoneWindowMemory(),window=popup(),pending=memory.begin('owner',window);pending.attemptId='attempt';
 assert.equal(memory.resume('owner'),pending);assert.equal(memory.resume('owner').attemptId,'attempt');assert.equal(window.closed,0);
 memory.finish(pending);assert.equal(memory.resume('owner'),null);assert.equal(window.closed,0,'The success page controls its own close delay');
});
test('another account or an expired attempt cannot inherit the old phone window',()=>{
 for(const expired of [false,true]){
  const memory=exportsForTest.createPhoneWindowMemory(),window=popup(),pending=memory.begin('owner',window);
  if(expired)pending.created=Date.now()-600001;
  assert.equal(memory.resume(expired?'owner':'other'),null);assert.equal(window.closed,1);
 }
});
test('late completion cannot clear a newer window, while cancellation closes only the current one',()=>{
 const memory=exportsForTest.createPhoneWindowMemory(),first=popup(),second=popup();
 const old=memory.begin('owner',first),current=memory.begin('owner',second);
 assert.equal(first.closed,1);memory.finish(old);assert.equal(memory.isCurrent(old),false);assert.equal(memory.resume('owner'),current);
 memory.cancel();assert.equal(second.closed,1);assert.equal(memory.resume('owner'),null);
});
test('unavailable or privacy-blocked BroadcastChannel selects the recovery path',()=>{
 const code=ts.transpileModule(fs.readFileSync('src/lib/phone-verification-window.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 for(const Channel of [undefined,class{constructor(){throw new Error('Blocked by browser');}}]){
  const out={};new Function('exports','BroadcastChannel',code)(out,Channel);assert.equal(out.openPhoneVerificationChannel(),null);
 }
});
