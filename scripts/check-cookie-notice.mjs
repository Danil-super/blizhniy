// Owned local browser profile only. No login, provider requests or production data.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {stateFile,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
import {cookieNoticeName} from '../src/lib/cookie-notice.ts';
const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const profile=await mkdtemp(join(tmpdir(),'blizhniy-cookie-browser-'));
let context;
const start=async()=>{
 const ctx=await chromium.launchPersistentContext(profile,{headless:true,ignoreHTTPSErrors:true,viewport:{width:390,height:844}});
 await ctx.route('**/*',route=>new URL(route.request().url()).origin===state.origin?route.continue():route.abort());
 return ctx;
};
try{
 context=await start();let page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.name));
 await page.goto(state.origin+'/');const notice=page.getByRole('region',{name:'Файлы cookie',exact:true});await notice.waitFor();
 assert.equal(await notice.getByRole('link',{name:'Подробнее',exact:true}).getAttribute('href'),'/legal/privacy#cookies');
 for(const [width,height]of [[320,740],[390,844],[768,1000],[1440,1000],[740,360]]){
  await page.setViewportSize({width,height});
  const box=await notice.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width&&box.y+box.height<=height);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(width===1440)await notice.screenshot({path:'/tmp/blizhniy-cookie-notice-desktop.png'});
  if(width<768){const nav=await page.getByRole('navigation',{name:'Мобильная навигация',exact:true}).boundingBox();assert.ok(box.y+box.height<nav.y,'Cookie notice must remain above mobile navigation');}
 }
 await page.setViewportSize({width:390,height:844});await notice.screenshot({path:'/tmp/blizhniy-cookie-notice-mobile.png'});
 await notice.getByRole('button',{name:'Понятно',exact:true}).click();await notice.waitFor({state:'detached'});
 const cookie=(await context.cookies(state.origin)).find(row=>row.name===cookieNoticeName);
 assert.ok(cookie);assert.equal(cookie.secure,true);assert.equal(cookie.sameSite,'Lax');assert.equal(cookie.path,'/');assert.equal(cookie.httpOnly,false);
 assert.ok(cookie.expires>Date.now()/1000+364*86400);assert.ok(cookie.expires<=Date.now()/1000+366*86400);
 assert.equal((await context.cookies(state.origin)).some(row=>row.name==='__Host-blizhniy_session'),false,'The information notice never creates an account session');
 await page.reload();assert.equal(await notice.count(),0);await context.close();context=null;
 context=await start();page=await context.newPage();page.on('pageerror',e=>errors.push(e.name));
 await page.goto(state.origin+'/');await page.getByRole('button',{name:'О файлах cookie',exact:true}).waitFor();
 assert.equal(await page.getByRole('region',{name:'Файлы cookie',exact:true}).count(),0,'Acknowledgement survives a full browser restart');
 await page.getByRole('button',{name:'О файлах cookie',exact:true}).click();const reopened=page.getByRole('region',{name:'Файлы cookie',exact:true});await reopened.waitFor();
 assert.equal(await reopened.evaluate(element=>document.activeElement===element),true);
 await reopened.getByRole('button',{name:'Понятно',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'О файлах cookie',exact:true}).evaluate(element=>document.activeElement===element),true);
 await page.goto(state.origin+'/legal/privacy#cookies');await page.locator('h2#cookies').waitFor();
 await context.addInitScript(()=>{Object.defineProperty(Document.prototype,'cookie',{configurable:true,get(){throw new Error('Storage blocked');},set(){throw new Error('Storage blocked');}});});
 await page.goto(state.origin+'/');const blocked=page.getByRole('region',{name:'Файлы cookie',exact:true});await blocked.waitFor();await blocked.getByRole('button',{name:'Понятно',exact:true}).click();await blocked.waitFor({state:'detached'});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,firstVisit:true,browserRestartPersists:true,reopenAndFocusRestore:true,mobileNavigationUnobstructed:true,blockedCookieAccessDoesNotBreakNotice:true,authChanges:false,productionTouched:false}));
}finally{await context?.close();await rm(profile,{recursive:true,force:true});}
