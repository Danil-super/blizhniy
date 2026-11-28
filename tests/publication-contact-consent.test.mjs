import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';

const {loadLocalPrimaryModule}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const {listingContactVisibility}=loadLocalPrimaryModule('publication-location-withdrawal');

test('listing contacts require independent grants and withdrawals override the rollout mode',()=>{
 const prior=process.env.BLIZHNIY_PUBLICATION_CONTACT_CONSENT;
 try{
  process.env.BLIZHNIY_PUBLICATION_CONTACT_CONSENT='required';
  assert.equal(listingContactVisibility(false),',true as "phoneHidden",true as "messengerHidden"');
  const strict=listingContactVisibility(true);
  assert.match(strict,/scope='phone'\)[\s\S]*'phone',to_jsonb\(l\.contact_phone\)\)\) as "phoneHidden"/);
  assert.match(strict,/scope='messenger'\)[\s\S]*'messenger',to_jsonb\(l\.messenger_url\)\)\) as "messengerHidden"/);
  delete process.env.BLIZHNIY_PUBLICATION_CONTACT_CONSENT;
  const legacy=listingContactVisibility(true);
  assert.ok(legacy.includes("scope='phone'")&&legacy.includes("scope='messenger'"));
  assert.ok(!legacy.includes('publication_is_consented'));
  assert.equal(listingContactVisibility(false),'');
 }finally{
  if(prior===undefined)delete process.env.BLIZHNIY_PUBLICATION_CONTACT_CONSENT;
  else process.env.BLIZHNIY_PUBLICATION_CONTACT_CONSENT=prior;
 }
});
