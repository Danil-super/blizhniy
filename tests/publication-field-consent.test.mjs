import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';

const {loadLocalPrimaryModule}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const {publicTextColumn,publicTextSql}=loadLocalPrimaryModule('publication-location-withdrawal');

test('required text consent protects the same field versions in public rows and search expressions',()=>{
 const prior=process.env.BLIZHNIY_PUBLICATION_TEXT_CONSENT;
 try{
  process.env.BLIZHNIY_PUBLICATION_TEXT_CONSENT='required';
  assert.equal(publicTextSql('l','title',false),"''");
  assert.match(publicTextColumn('w',false),/'description',''/);
  for(const alias of ['l','w','s']){
   assert.match(publicTextSql(alias,'title',true),/case when app_publication_privacy.text_is_consented\([\s\S]+then [\s\S]+public_text\(/);
   assert.match(publicTextColumn(alias,true),/text_is_consented/);
  }
  delete process.env.BLIZHNIY_PUBLICATION_TEXT_CONSENT;
  assert.equal(publicTextSql('l','title',false),'l.title');
  assert.doesNotMatch(publicTextSql('w','description',true),/text_is_consented/);
 }finally{
  if(prior===undefined)delete process.env.BLIZHNIY_PUBLICATION_TEXT_CONSENT;
  else process.env.BLIZHNIY_PUBLICATION_TEXT_CONSENT=prior;
 }
});
