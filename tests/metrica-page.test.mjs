import assert from 'node:assert/strict';
import {test} from 'node:test';
import {metricaPage,metricaPublicPath} from '../src/lib/metrica-page.ts';
const site='https://xn----9sbphbgks4a4a.xn--p1ai';

test('public analytics strips queries/fragments and aggregates personal record identifiers',()=>{
 const cases=[['/','/'],['/katalog/instrumenty','/katalog/category'],['/poisk?q=person%40example.test&page=2#private-fragment','/poisk'],
  ['/obyavlenie/private-sentinel-record','/obyavlenie/card'],['/specialist/private-sentinel-person','/specialist/card'],
  ['/vakansiya/private-sentinel-record','/vakansiya/card'],['/prodavets/private-sentinel-owner','/prodavets/profile'],
  ['/rabota/zakazy/private-sentinel-record','/rabota/zakazy/card']];
 for(const [path,expected] of cases){
  const page=metricaPage(site+path,site,'https://search.example.test/results?q=private-sentinel');
  assert.deepEqual(page,{url:site+expected,referer:'https://search.example.test/',title:'Ближний'});
  assert.doesNotMatch(JSON.stringify(page),/private-sentinel|person%40|private-fragment/);
 }
});
test('arbitrary category/profession slugs never expose personal values in page or referer',()=>{
 for(const [path,expected] of [
  ['/katalog/person-79001234567','/katalog/category'],
  ['/katalog/category/person-79001234567','/katalog/category/subcategory'],
  ['/rabota/specialisty/person-79001234567','/rabota/specialisty/category'],
  ['/krasnodar/rabota/specialisty/person-79001234567','/rabota/specialisty/category']
 ]){
  assert.equal(metricaPage(site+path,site).url,site+expected);
  assert.equal(metricaPage(site+'/',site,site+path).referer,site+expected);
  assert.doesNotMatch(JSON.stringify(metricaPage(site+path,site,site+path)),/79001234567/);
 }
});
test('private, payment, editing, deferred and unknown routes never produce analytics',()=>{
 for(const path of ['/auth','/auth/reset?token=sentinel','/cabinet','/cabinet/moi-dannye','/admin/users','/oplata/secret','/api/account/profile',
 '/razmestit','/razmestit/obyavlenie','/obyavlenie/one/edit','/obyavlenie/one/redaktirovat',
 '/rabota/vakansii/sozdat','/krasnodar/rabota/zakazy/one/redaktirovat','/rabota/specialisty/anketa','/krasnodar/sozdat',
 '/yarmarka-masterov','/yarmarka-masterov/zayavka','/unknown/new-route', '/poisk?email=sentinel@example.test','/?token=sentinel']){
  assert.equal(metricaPage(site+path,site),null,path);
 }
});
test('analytics rejects foreign/non-TLS sites and malformed path/credentials, never forwards private referer',()=>{
 for(const [href,origin] of [['http://localhost/', 'http://localhost'],['https://other.test/',site],[site+'/',site+'/path'],['https://person:password@example.test/','https://example.test']])assert.equal(metricaPage(href,origin),null);
 for(const path of ['/katalog/%','/katalog/%2e%2e','/katalog//foo','/katalog/%252fsecret','/katalog/%00','/cabinet%2Fphone'])assert.equal(metricaPublicPath(path),null,path);
 assert.equal(metricaPage(site+'/',site,site+'/auth/reset?token=secret').referer,'');
 assert.equal(metricaPage(site+'/',site,'https://user:secret@source.test/path').referer,'');
 assert.equal(metricaPage(site+'/',site,site+'/obyavlenie/private-id?q=secret').referer,site+'/obyavlenie/card');
});
