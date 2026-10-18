import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseWorkReviewDecision} from '../src/lib/work-moderation-contract.ts';
test('work moderation decisions have exact state and plain bounded rejection explanations',()=>{
 assert.deepEqual(parseWorkReviewDecision('approved',null),{state:'approved',note:null});
 assert.deepEqual(parseWorkReviewDecision('rejected','Добавьте описание.'),{state:'rejected',note:'Добавьте описание.'});
 for(const [state,note] of [['pending',null],['approved','text'],['rejected',null],['rejected',''],['rejected',' x'],['rejected','x\n'],['rejected','x'.repeat(1001)],['rejected','\ud800']])assert.throws(()=>parseWorkReviewDecision(state,note));
});
