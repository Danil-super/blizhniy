import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';

const {loadLocalPrimaryModule}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const {publicPhotoEligibility,withdrawnPhotoColumn}=loadLocalPrimaryModule('publication-location-withdrawal');

test('photos use the exact attachment and digest in lists, cards and the direct file guard',()=>{
 const prior=process.env.BLIZHNIY_PUBLICATION_PHOTO_CONSENT;
 try{
  process.env.BLIZHNIY_PUBLICATION_PHOTO_CONSENT='required';
  assert.equal(publicPhotoEligibility('l','image.id',false),' and false');
  assert.match(publicPhotoEligibility('l','p.media_id',true),/scope='photo:'\|\|p\.media_id::text[\s\S]+publication_is_consented\('listing',l\.id,l\.author_id,'photo:'\|\|p\.media_id::text[\s\S]+media\.sha256/);
  assert.match(publicPhotoEligibility('s','image.id',true),/publication_is_consented\(s\.kind,s\.id,s\.author_id,'photo:'\|\|image\.id::text[\s\S]+media\.sha256/);
  assert.match(withdrawnPhotoColumn('w',false),/and false/);
  assert.match(withdrawnPhotoColumn('s',true),/publication_is_consented/);
  delete process.env.BLIZHNIY_PUBLICATION_PHOTO_CONSENT;
  assert.doesNotMatch(publicPhotoEligibility('l','image.id',true),/publication_is_consented/);
  assert.match(publicPhotoEligibility('l','image.id',true),/scope='photo:'\|\|image\.id::text/);
 }finally{
  if(prior===undefined)delete process.env.BLIZHNIY_PUBLICATION_PHOTO_CONSENT;
  else process.env.BLIZHNIY_PUBLICATION_PHOTO_CONSENT=prior;
 }
});
