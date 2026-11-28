import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';

const {loadLocalPrimaryModule}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const {publicProfileNameSql,publicAvatarSql}=loadLocalPrimaryModule('publication-location-withdrawal');

test('public profile values default to hidden in the new mode and saved withdrawals apply in both modes',()=>{
 const prior=process.env.BLIZHNIY_PUBLICATION_PROFILE_CONSENT;
 try{
  process.env.BLIZHNIY_PUBLICATION_PROFILE_CONSENT='required';
  assert.equal(publicProfileNameSql('l',false),'null');
  assert.equal(publicProfileNameSql('s',false),'null');
  assert.equal(publicAvatarSql(false),"''");
  assert.match(publicProfileNameSql('l',true),/scope='name'[\s\S]+publication_is_consented\('listing',l\.id,l\.author_id,'name'/);
  assert.match(publicProfileNameSql('s',true),/scope='name'[\s\S]+publication_is_consented\(s\.kind,s\.id,s\.author_id,'name'/);
  assert.match(publicAvatarSql(true),/scope='avatar'[\s\S]+publication_is_consented\(s\.kind,s\.id,s\.author_id,'avatar',[\s\S]+avatar_facts/);
  delete process.env.BLIZHNIY_PUBLICATION_PROFILE_CONSENT;
  assert.match(publicProfileNameSql('s',true),/scope='name'/);
  assert.match(publicAvatarSql(true),/scope='avatar'/);
  assert.ok(!publicAvatarSql(true).includes('publication_is_consented'));
 }finally{
  if(prior===undefined)delete process.env.BLIZHNIY_PUBLICATION_PROFILE_CONSENT;
  else process.env.BLIZHNIY_PUBLICATION_PROFILE_CONSENT=prior;
 }
});
