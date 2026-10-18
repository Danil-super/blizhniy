import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorkPublicationSave} from '../src/lib/work-publication-save.ts';
import {parseWorkPublicationForm} from '../src/lib/work-publication-contract.ts';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',media='33333333-3333-4333-8333-333333333333';
const input={kind:'workRequest',title:'Synthetic original',budget:'12.1'};
function fixture(){let saved=null;const calls=[];const dependencies={
 upload:async(_owner,intent,file)=>{calls.push(['upload',intent,file.size]);return{id:media,mimeType:'image/webp',width:2,height:2,size:12};},
 create:async(_owner,kind,key,form)=>{calls.push(['create',key,structuredClone(form)]);saved={id,kind,form,revision:'1',photos:[]};return saved;},
 update:async(_owner,kind,pid,revision,form)=>{calls.push(['update',pid,revision,form]);saved={id:pid,kind,form,revision:String(BigInt(revision)+1n),photos:[]};return saved;},
 read:async()=>{calls.push(['read']);return saved;},intent:async(_owner,_kind,key)=>{calls.push(['intent',key]);return saved;},
 };return{calls,dependencies,get saved(){return saved;},set saved(value){saved=value;}};}
test('work save captures full form once, uploads before atomic create and never creates an empty record',async()=>{
 const f=fixture(),source={...input},file=new Blob(['synthetic'],{type:'image/png'}),save=createWorkPublicationSave(owner,'workRequest',source,[file],f.dependencies);
 source.title='Changed after click';const result=await save.save();assert.equal(result.form.title,input.title);assert.deepEqual(result.form.photoIds,[media]);
 assert.deepEqual(f.calls.map(c=>c[0]),['upload','create']);assert.equal(save.completed,result);assert.equal(save.uncertain,false);
 assert.equal(await save.save(),result);assert.equal(f.calls.length,2);
});
test('lost create acknowledgement recovers via read-only stable intent, never a second create',async()=>{
 const f=fixture(),create=f.dependencies.create;f.dependencies.create=async(...args)=>{await create(...args);throw Error('Synthetic lost acknowledgement');};
 const save=createWorkPublicationSave(owner,'workRequest',input,[],f.dependencies);
 await assert.rejects(()=>save.save());assert.equal(save.uncertain,true);await assert.rejects(()=>save.save());
 assert.equal(await save.readback(),f.saved);assert.equal(save.completed,f.saved);assert.equal(save.uncertain,false);
 assert.deepEqual(f.calls.map(c=>c[0]),['create','intent']);assert.equal(f.calls[0][1],f.calls[1][1]);
});
test('read-only null intent permits an explicit retry with the same creation key only',async()=>{
 const f=fixture(),create=f.dependencies.create;let first=true;
 f.dependencies.create=async(...args)=>{if(first){first=false;f.calls.push(['unknown',args[2]]);throw Error('Synthetic network failure');}return create(...args);};
 const save=createWorkPublicationSave(owner,'workRequest',input,[],f.dependencies);
 await assert.rejects(()=>save.save());assert.equal(await save.readback(),null);assert.equal(save.uncertain,false);
 await save.save();assert.deepEqual(f.calls.map(c=>c[0]),['unknown','intent','create']);assert.equal(f.calls[0][1],f.calls[2][1]);
});
test('unknown edit recovers identical snapshot without reapplying a CAS write',async()=>{
 const f=fixture(),initial={id,kind:'workRequest',form:parseWorkPublicationForm('workRequest',{...input,title:'Before'}),revision:'9007199254740993',photos:[]};
 const update=f.dependencies.update;f.dependencies.update=async(...args)=>{await update(...args);throw Error('Synthetic lost reply');};
 const save=createWorkPublicationSave(owner,'workRequest',input,[],f.dependencies,initial);
 await assert.rejects(()=>save.save());await save.readback();assert.equal(save.completed.revision,'9007199254740994');assert.deepEqual(f.calls.map(c=>c[0]),['update','read']);
});
test('conflicting remote form is never silently replaced; explicit acceptance uses exact remote revision',async()=>{
 const f=fixture();f.dependencies.create=async(_owner,kind,key)=>{f.calls.push(['create',key]);return f.saved={id,kind,revision:'9007199254740993',form:parseWorkPublicationForm(kind,{...input,title:'Other version'}),photos:[]};};
 const save=createWorkPublicationSave(owner,'workRequest',input,[],f.dependencies);
 await assert.rejects(()=>save.save());assert.equal(save.uncertain,true);assert.equal(save.completed,null);await save.readback();
 assert.deepEqual(f.calls.map(c=>c[0]),['create','intent']);save.acceptRemoteRevision();await save.save();
 assert.equal(f.calls[2][2],'9007199254740993');assert.equal(save.completed.form.title,input.title);
});
test('upload attempts keep stable intents and concurrent save calls cannot duplicate mutation',async()=>{
 const f=fixture(),upload=f.dependencies.upload;let release,first=true;
 f.dependencies.upload=async(...args)=>{if(first){first=false;await new Promise(resolve=>{release=resolve;});}return upload(...args);};
 const save=createWorkPublicationSave(owner,'workRequest',input,[new Blob(['x'],{type:'image/png'})],f.dependencies),pending=save.save();
 await assert.rejects(()=>save.save());release();await pending;assert.deepEqual(f.calls.map(c=>c[0]),['upload','create']);
});
test('work save validates photo count/types/owner and captured edit identity before I/O',()=>{
 const f=fixture();for(const files of [[new Blob([],{type:'image/png'})],[new Blob(['x'],{type:'text/html'})],Array.from({length:7},()=>new Blob(['x'],{type:'image/png'}))]){
  assert.throws(()=>createWorkPublicationSave(owner,'workRequest',input,files,f.dependencies));}
 assert.throws(()=>createWorkPublicationSave('bad','workRequest',input,[],f.dependencies));
 assert.throws(()=>createWorkPublicationSave(owner,'workRequest',input,[],f.dependencies,{id,kind:'vacancy',revision:'1'}));assert.deepEqual(f.calls,[]);
});
