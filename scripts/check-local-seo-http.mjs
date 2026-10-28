import assert from 'node:assert/strict';
import https from 'node:https';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {stateFile,stateDirectory} from './local-primary-fixture.mjs';
import {readLocalPrimaryState} from './local-primary-config.mjs';

const state=readLocalPrimaryState(stateFile,process.cwd());
const publicOrigin='https://xn----9sbphbgks4a4a.xn--p1ai';
const ca=readFileSync(join(stateDirectory,'tls-cert.pem'));
function read(path){
 return new Promise((resolve,reject)=>{
  const request=https.get(new URL(path,state.origin),{ca,timeout:20000},response=>{
   const chunks=[];let size=0;
   response.on('data',chunk=>{size+=chunk.length;if(size>4000000)request.destroy(Error('Unexpected local SEO response size'));else chunks.push(chunk);});
   response.once('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks).toString('utf8')}));
   response.once('error',reject);
  });
  request.once('timeout',()=>request.destroy(Error('Local SEO request timed out')));
  request.once('error',reject);
 });
}
const noindex=/<meta[^>]*name="robots"[^>]*content="[^"]*noindex/;
const sitemap=await read('/sitemap.xml');assert.equal(sitemap.status,200);
const urls=[...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match=>match[1]);
assert.ok(urls.includes(publicOrigin+'/rekvizity'));
assert.equal(new Set(urls).size,urls.length);
for(const url of urls){
 const parsed=new URL(url);assert.equal(parsed.origin,publicOrigin);
 assert.doesNotMatch(parsed.pathname,/^\/(auth|cabinet|admin|api|oplata|razmestit)(?:\/|$)/);
}
const publications=urls.filter(url=>/\/(obyavlenie|vakansiya|specialist|rabota\/zakazy)\/[^/]+$/.test(url));
for(const url of publications){
 const response=await read(new URL(url).pathname);assert.equal(response.status,200);
 assert.doesNotMatch(response.body,noindex);
 assert.ok(response.body.includes(`rel="canonical" href="${url}"`));
}
for(const [path,target] of [
 ['/katalog/sad-i-rasteniya-0','/katalog/sad-i-rasteniya'],
 ['/katalog/dlya-doma-i-dachi/для-дома-и-дачи','/katalog/dlya-doma-i-dachi'],
]){
 const response=await read(encodeURI(path));assert.equal(response.status,308,path);
 assert.equal(response.headers.location,target);
 assert.equal((await read(target)).status,200);
}
for(const [kind,label] of [['prodam','Продам'],['kuplyu','Куплю'],['otdam-darom','Отдам даром'],['arenda','Аренда']]){
 const response=await read('/obyavleniya?kind='+kind);assert.equal(response.status,200);
 assert.match(response.body,new RegExp(`<h1[^>]*>${label}</h1>`));
 assert.match(response.body,new RegExp(`<title>[^<]*${label}`));
}
const requisites=await read('/rekvizity');assert.equal(requisites.status,200);
assert.ok(requisites.body.includes(`rel="canonical" href="${publicOrigin}/rekvizity"`));
for(const path of ['/auth','/cabinet','/razmestit/obyavlenie']){
 const response=await read(path);assert.equal(response.status,200);assert.match(response.body,noindex);
}
const missing=await read('/obyavlenie/30582b23-9b99-4bc1-a63e-0bc3e97bf3ef');
assert.equal(missing.status,404);assert.match(missing.body,noindex);
console.log(JSON.stringify({status:'passed',sitemapUrls:urls.length,publicDetailUrls:publications.length,redirects:2,kindMetadata:4,privateNoindex:3,missing404:true,productionTouched:false}));
