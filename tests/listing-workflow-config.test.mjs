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

test('postmoderation promotion requires the exact Russian primary account origin and does not imply local simulation',()=>{const production={BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai'};assert.equal(readPostmoderationEnabled(production),true);assert.equal(production.BLIZHNIY_LOCAL_PRIMARY,undefined);for(const patch of [{BLIZHNIY_AUTH_MODE:'local'},{BLIZHNIY_AUTH_MODE:'legacy'},{BLIZHNIY_AUTH_ORIGIN:'https://evil.invalid'}])assert.throws(()=>readPostmoderationEnabled({...production,...patch}));});
