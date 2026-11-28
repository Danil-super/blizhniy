import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';

const {loadLocalPrimaryModule}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const {locationWithdrawalColumn}=loadLocalPrimaryModule('publication-location-withdrawal');

test('required location consent gates each anonymous projection and hides locations without the base schema',()=>{
 const prior=process.env.BLIZHNIY_PUBLICATION_LOCATION_CONSENT;
 process.env.BLIZHNIY_PUBLICATION_LOCATION_CONSENT='required';
 try{
  for (const [alias,kind] of [['l',"'listing'"],['w','w.kind'],['s','s.kind']]){
   assert.equal(locationWithdrawalColumn(alias,false),',true as "locationWithdrawn"');
   const projection=locationWithdrawalColumn(alias,true);
   assert.ok(projection.includes(`not app_publication_privacy.location_is_consented(${kind},${alias}.id,`));
   assert.ok(projection.includes("scope='location'"));
  }
 }finally{
  if(prior===undefined)delete process.env.BLIZHNIY_PUBLICATION_LOCATION_CONSENT;
  else process.env.BLIZHNIY_PUBLICATION_LOCATION_CONSENT=prior;
 }
});
