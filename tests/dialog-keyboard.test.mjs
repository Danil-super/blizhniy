import assert from 'node:assert/strict';
import {test} from 'node:test';
import {containDialogTab,openDialog} from '../src/lib/dialog-keyboard.ts';
function fixture({key='Tab',shiftKey=false,active='middle',items=['first','middle','last']}={}){
 let prevented=0,queries=0;const controls=items.map(name=>({name,tabIndex:0,getClientRects:()=>[{}],matches:()=>false,focus(){doc.activeElement=this;}}));
 const doc={activeElement:controls.find(node=>node.name===active)},dialog={ownerDocument:doc,querySelectorAll(){queries++;return controls;},focus(){doc.activeElement=this;}};
 if(active==='dialog')doc.activeElement=dialog;
 const event={key,shiftKey,currentTarget:dialog,preventDefault:()=>prevented++};
 return{event,dialog,doc,controls,prevented:()=>prevented,queries:()=>queries};
}

test('photo dialog wraps Tab and Shift+Tab at its current boundary controls',()=>{
 for(const [active,shiftKey,expected]of[['last',false,'first'],['first',true,'last'],['dialog',false,'first'],['dialog',true,'last']]){
  const f=fixture({active,shiftKey});containDialogTab(f.event);assert.equal(f.doc.activeElement.name,expected);assert.equal(f.prevented(),1);
 }
 const middle=fixture();containDialogTab(middle.event);assert.equal(middle.prevented(),0);
 const other=fixture({key:'ArrowRight'});containDialogTab(other.event);assert.equal(other.queries(),0);assert.equal(other.prevented(),0);
});

test('photo dialog never wraps into hidden, negative-tabindex or disabled controls',()=>{
 const f=fixture({active:'last'});
 f.controls[0].getClientRects=()=>[];f.controls[1].matches=()=>true;
 const negative={name:'negative',tabIndex:-1,getClientRects:()=>[{}],matches:()=>false};f.controls.unshift(negative);
 containDialogTab(f.event);assert.equal(f.doc.activeElement.name,'last');assert.equal(f.prevented(),1);
});

test('photo dialog keeps focus in the modal while all controls are temporarily unavailable',()=>{
 const f=fixture();f.controls.forEach(node=>node.matches=()=>true);containDialogTab(f.event);
 assert.equal(f.doc.activeElement,f.dialog);assert.equal(f.prevented(),1);
});

test('closing a removed photo dialog restores only a connected invoker after native close',()=>{
 const calls=[],invoker={isConnected:true,focus:()=>calls.push('focus')};
 const dialog={ownerDocument:{activeElement:invoker},showModal:()=>calls.push('open'),close:()=>calls.push('close')};
 const cleanup=openDialog(dialog);assert.deepEqual(calls,['open']);dialog.ownerDocument.activeElement=null;
 cleanup();assert.deepEqual(calls,['open','close','focus']);
 calls.length=0;const detached=openDialog(dialog);detached();assert.deepEqual(calls,['open','close']);
 dialog.ownerDocument.activeElement=invoker;invoker.isConnected=false;calls.length=0;
 openDialog(dialog)();assert.deepEqual(calls,['open','close']);
 invoker.isConnected=true;calls.length=0;dialog.ownerDocument.activeElement=null;
 openDialog(dialog,invoker)();assert.deepEqual(calls,['open','close','focus']);
});
