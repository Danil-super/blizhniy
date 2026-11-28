import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';

const {loadLocalPrimaryModule}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const {publicLinkColumn}=loadLocalPrimaryModule('publication-location-withdrawal');
const {mapPublicWorkPublication}=loadLocalPrimaryModule('public-work-publications');

test('public link projections enforce the publication kind, exact URL and stored withdrawal',()=>{
 const prior=process.env.BLIZHNIY_PUBLICATION_LINK_CONSENT;
 try{
  process.env.BLIZHNIY_PUBLICATION_LINK_CONSENT='required';
  for(const alias of ['w','s'])assert.equal(publicLinkColumn(alias,false),',true as "linkHidden"');
  assert.match(publicLinkColumn('w',true),/scope='link'[\s\S]+publication_is_consented\(w\.kind,w\.id,w\.author_id,'link',to_jsonb\(w\.form->>'website'\)/);
  assert.match(publicLinkColumn('s',true),/scope='link'[\s\S]+publication_is_consented\(s\.kind,s\.id,s\.author_id,'link',to_jsonb\(s\.form->>case s\.kind when 'marquee' then 'href' else 'videoUrl' end\)/);
  delete process.env.BLIZHNIY_PUBLICATION_LINK_CONSENT;
  assert.match(publicLinkColumn('s',true),/scope='link'/);
  assert.doesNotMatch(publicLinkColumn('s',true),/publication_is_consented/);
 }finally{
  if(prior===undefined)delete process.env.BLIZHNIY_PUBLICATION_LINK_CONSENT;
  else process.env.BLIZHNIY_PUBLICATION_LINK_CONSENT=prior;
 }
});

test('the stored vacancy website respects the public projection without removing the vacancy',()=>{
 const website='https://example.invalid/work-fixture';
 const row={
  id:'12345678-1234-4321-8765-123456789abc',kind:'vacancy',mediaIds:[],status:'published',paid:true,
  createdAt:'2026-11-22T12:00:00.000Z',publishedAt:'2026-11-23T12:00:00.000Z',expiresAt:'2026-12-01T12:00:00.000Z',
  form:{title:'Стендовая вакансия',description:'Описание синтетической вакансии.',cityName:'Краснодар',professionName:'Сантехник',
   employerType:'person',organization:'Стендовый Работодатель',contactPhone:'+79995550001',placementRightConfirmed:true,website},
 };
 const now=Date.parse('2026-11-28T12:00:00.000Z');
 const visible=mapPublicWorkPublication({...row,linkHidden:false},now);
 assert.equal(visible.website,website);
 const hidden=mapPublicWorkPublication({...row,linkHidden:true},now);
 assert.equal(hidden.id,row.id);
 assert.equal(hidden.title,row.form.title);
 assert.ok(!Object.hasOwn(hidden,'website'));
});
