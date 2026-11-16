// Owned public synthetic stand; no accounts, writes or provider calls.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {stateFile,stateDirectory,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);assert.equal(state.origin,'https://127.0.0.1:3045');
const browser=await chromium.launch({headless:true}),results=[],errors=[],external=[];
const sizes=[320,360,390,412,639,768,1440];
try{
 for(const dpr of [1,1.75,2])for(const width of sizes){
  const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width,height:940},deviceScaleFactor:dpr});
  try{
   await context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==state.origin){external.push(url.origin);return route.abort();}return route.continue();});
   const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.name));
   assert.equal((await page.goto(state.origin,{waitUntil:'networkidle'})).status(),200);
   const image=page.locator('img[fetchpriority=high]');assert.equal(await image.count(),1);
   const info=await image.evaluate(i=>{const r=i.getBoundingClientRect();return{src:i.currentSrc,x:r.x,y:r.y,width:r.width,height:r.height,position:getComputedStyle(i).objectPosition,overflow:document.documentElement.scrollWidth>innerWidth};});
   const resource=await context.request.get(info.src,{headers:{Origin:state.origin,Accept:'image/webp'}});assert.equal(resource.status(),200);
   const received=await sharp(await resource.body()).metadata(),source=await sharp(width>=1024?'public/images/categories/home-hero-desktop.webp':'public/images/categories/home-hero-main.webp').metadata();
   assert.ok(received.width&&received.height&&source.width&&source.height);assert.equal(received.format,'webp');
   const coverWidth=Math.max(info.width,info.height*source.width/source.height),needed=Math.min(source.width,coverWidth*dpr),ratio=received.width/needed;
   results.push({viewport:width,dpr,...info,pixels:received.width,needed,ratio});
  }finally{await context.close();}
 }
}finally{await browser.close();}
const artifact='home-image-sizing-'+randomUUID()+'.json';await writeFile(join(stateDirectory,artifact),JSON.stringify({results,errors,external},null,2),{flag:'wx',mode:0o600});
const failures=results.filter(row=>row.overflow||row.ratio<.9||row.viewport>=390&&row.viewport<=639&&row.dpr===1.75&&row.pixels>1200);
console.log(JSON.stringify({checks:results.length,artifact,failures:failures.map(({viewport,dpr,pixels,needed})=>({viewport,dpr,pixels,needed}))}));
assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(failures,[],'Hero must cover its real crop at the device density without oversized regular-phone downloads');
