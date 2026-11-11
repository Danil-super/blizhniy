import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const operationId='10000000-0000-4000-8000-000000000001',publicationId='10000000-0000-4000-8000-000000000002';
const request={operationId,publicationId,kind:'workRequest',expectedRevision:'1',action:'withdraw',reason:'Работы больше не требуются.'};
test('work owner actions accept exact operation-bound inputs and a plain required closure reason',()=>{
 const {parseWorkOwnerAction}=load('work-owner-actions-contract');assert.deepEqual(parseWorkOwnerAction(request),request);
 assert.deepEqual(parseWorkOwnerAction({...request,action:'restore',reason:null}),{...request,action:'restore',reason:null});
 assert.deepEqual(parseWorkOwnerAction({...request,action:'remove',reason:'  Заказ закрыт.  '}),{...request,action:'remove',reason:'Заказ закрыт.'});
 for(const patch of [{action:'publish'},{action:'restore',reason:'Не нужна'},{reason:null},{reason:''},{reason:'😀'.repeat(251)},{reason:'<script>x</script>'},{reason:'Причина\u202e'},{expectedRevision:'0'},{kind:'listing'},{operationId:'other'},{amount:'1.00'},{ownerId:publicationId}])assert.throws(()=>parseWorkOwnerAction({...request,...patch}));
});
test('work lifecycle activation is absent by default and restricted to the owned local HTTPS stand',()=>{
 const {readWorkOwnerActionsEnabled}=load('work-owner-actions-contract');assert.equal(readWorkOwnerActionsEnabled({}),false);
 const env={BLIZHNIY_WORK_OWNER_ACTIONS:'local-v1',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045'};
 assert.equal(readWorkOwnerActionsEnabled(env),true);
 for(const patch of [{BLIZHNIY_LOCAL_PRIMARY:undefined},{BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://example.invalid'},{BLIZHNIY_WORK_OWNER_ACTIONS:'enabled'}])assert.throws(()=>readWorkOwnerActionsEnabled({...env,...patch}));
});
