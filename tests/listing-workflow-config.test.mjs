import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readPostmoderationEnabled} from '../src/lib/listing-workflow-config.ts';

test('postmoderation is isolated to an explicit HTTPS loopback primary stand',()=>{
 const local={BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045'};
 assert.equal(readPostmoderationEnabled({}),false);
 assert.equal(readPostmoderationEnabled({BLIZHNIY_LISTING_WORKFLOW:'pre-moderation'}),false);
 assert.equal(readPostmoderationEnabled(local),true);
 for(const patch of [{BLIZHNIY_LOCAL_PRIMARY:undefined},{BLIZHNIY_LOCAL_PRIMARY:'true'},{BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'http://127.0.0.1:3045'},{BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://example.com:3045'},{BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045/path'},{BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045?x=1'},{BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://user@127.0.0.1:3045'},{BLIZHNIY_LISTING_WORKFLOW:'unknown'}])assert.throws(()=>readPostmoderationEnabled({...local,...patch}));
});
