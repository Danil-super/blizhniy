import assert from 'node:assert/strict';import {test} from 'node:test';import {createRequire} from 'node:module';
const {loadLocalPrimaryModule:load}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const {parseAdminTariffCommand:command,parseAdminTariffResult:result,normalizeAdminTariffPrice:price,tariffCheckoutNotice:notice}=load('admin-tariff-contract');
const actor='11111111-1111-4111-8111-111111111111',operation='22222222-2222-4222-8222-222222222222';
const row={id:'listing-publication',action:'listing_publication',name:'Размещение',price:'199.00',durationDays:30,active:true,revision:'a'.repeat(64)};
const input={resource:'tariffs',action:'change',expectedAdminId:actor,input:{id:operation,tariffId:row.id,expectedRevision:row.revision,name:'Новый тариф',price:'249.50',durationDays:30,active:true,reason:'Новая цена'}};
test('tariff commands use exact fields, decimal strings and catalog zero/null without coercion',()=>{
 assert.deepEqual(command(input),input);assert.equal(price(' 00012,3 '),'12.30');assert.equal(price('0'),'0.00');
 assert.deepEqual(command({...input,input:{...input.input,price:'0.00',durationDays:null}}).input.durationDays,null);
 for(const patch of [{price:'249.50\n'},{expectedRevision:'a'.repeat(64)+'\n'},{tariffId:row.id+'\n'},{price:249.5},{price:'249.5'},{price:'1e2'},{price:'-1.00'},{price:'10000000000.00'},{price:'001.00'},{durationDays:0},{durationDays:3651},{active:1},{name:'<script>x</script>'},{reason:'  '},{tariffId:'../other'},{expectedRevision:'bad'},{action:'job_response'}])assert.throws(()=>command({...input,input:{...input.input,...patch}}));
 assert.throws(()=>command({...input,token:'client-authority'}));
 for(const text of ['1e2','-1','1.001','1 000','Infinity','1,2,3'])assert.throws(()=>price(text));
});
test('tariff response binds receipts to original actor, ID, revision and exact desired values',()=>{
 const next={...row,name:input.input.name,price:input.input.price,revision:'b'.repeat(64)};
 const receipt={id:operation,actorId:actor,tariffId:row.id,expectedRevision:row.revision,previous:row,next,reason:input.input.reason,changed:true,createdAt:'2026-11-17T10:00:00.000000Z'};
 const response={tariffs:[next],receipt,history:[receipt]};assert.deepEqual(result(input,response),response);
 const later={...row,revision:'c'.repeat(64)};assert.equal(result(input,{...response,tariffs:[later]}).receipt.id,operation);
 for(const patch of [{actorId:operation},{id:actor},{reason:'Другая причина'},{expectedRevision:'d'.repeat(64)},{next:{...next,price:'299.00'}},{changed:false}])assert.throws(()=>result(input,{...response,receipt:{...receipt,...patch}}));
 assert.throws(()=>result(input,{...response,history:[receipt,receipt]}));
 assert.throws(()=>result(input,{...response,tariffs:[next,next]}));
 assert.throws(()=>result(input,{...response,tariffs:[{...next,price:'399.00'}]}));
 const recover={resource:'tariffs',action:'recover',expectedAdminId:actor,tariffId:row.id,id:operation};
 assert.equal(result(recover,{tariffs:[],receipt,history:[receipt]}).receipt.id,operation);
 assert.deepEqual(result({resource:'tariffs',action:'list',expectedAdminId:actor},{tariffs:[{...row,price:'0.00',durationDays:null}],receipt:null,history:[]}).tariffs[0].price,'0.00');
});
test('catalog configuration warnings explain zero/null without inventing free checkout',()=>{
 assert.equal(notice(row),null);assert.match(notice({...row,price:'0.00'}),/не означает бесплатную/);
 assert.match(notice({...row,durationDays:null}),/срок/);assert.equal(notice({...row,action:'job_response',durationDays:null}),null);
 assert.match(notice({...row,action:'job_response',durationDays:30}),/разов/);
});
