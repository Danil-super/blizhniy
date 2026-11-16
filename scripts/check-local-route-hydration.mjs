// Read-only browser fixtures on the owned stand; no account or payment writes.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {stateFile,stateDirectory,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
import {observeBrowserHydration} from './local-browser-hydration.mjs';

const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
assert.equal(state.origin,'https://127.0.0.1:3045');
const browser=await chromium.launch(),run=randomUUID(),errors=[],hydration=[],external=[],id='22222222-2222-4222-8222-222222222222';
let navigations=0,clientTransitions=0;
try{
 for(const width of [320,1440])for(const delay of [0,100]){
  const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width,height:1000}});
  try{
   hydration.push(await observeBrowserHydration(context));
   await context.addInitScript(()=>{
    const observer=new MutationObserver(()=>{const shell=document.querySelector('.app-shell');if(shell){window.__syntheticServerShell=shell;observer.disconnect();}});
    observer.observe(document,{childList:true,subtree:true});
   });
   await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==state.origin){external.push(url.origin);return route.abort();}
    if(url.pathname.startsWith('/api/'))return route.fulfill({status:url.pathname==='/api/account/session'?200:503,contentType:'application/json',body:JSON.stringify(url.pathname==='/api/account/session'?{user:{id,email:'synthetic@local.invalid',role:'user',isBlocked:false}}:{error:{code:'AUTH_UNAVAILABLE'}})});
    if(delay&&url.pathname.endsWith('.js'))await new Promise(resolve=>setTimeout(resolve,delay));
    return route.continue();
   });
   const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.name));
   for(let cycle=0;cycle<12;cycle++)for(const path of ['/cabinet/zakazy',`/rabota/zakazy/${id}/edit`]){
    const response=await page.goto(state.origin+path);assert.equal(response.status(),200);
    if(path==='/cabinet/zakazy')await page.getByRole('link',{name:'Создать заказ',exact:true}).waitFor();
    else await page.getByRole('heading',{name:'Редактирование заказа',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>!!window.__syntheticServerShell&&document.querySelector('.app-shell')===window.__syntheticServerShell),true,'SSR shell must survive hydration');
    navigations++;
   }
   await page.goto(state.origin+'/cabinet/zakazy');navigations++;
   await page.getByRole('link',{name:'Создать заказ',exact:true}).waitFor();
   const timeOrigin=await page.evaluate(()=>performance.timeOrigin);
   for(const [label,path,ready] of [['Вакансии','/cabinet/vakansii','Создать вакансию'],['Заказы','/cabinet/zakazy','Создать заказ']]){
    await page.getByRole('link',{name:label,exact:true}).click();await page.waitForURL(state.origin+path);
    await page.getByRole('link',{name:ready,exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>performance.timeOrigin),timeOrigin,'Client navigation must retain the same document');
    assert.equal(await page.evaluate(()=>document.querySelector('.app-shell')===window.__syntheticServerShell),true,'Client navigation must retain the root layout');
    clientTransitions++;
   }
  }finally{await context.close();}
 }
 assert.deepEqual(errors,[]);assert.deepEqual(hydration.flat(),[]);assert.deepEqual(external,[]);
 console.log(JSON.stringify({status:'passed',navigations,clientTransitions,ssrPreserved:true,pageErrors:0,realApiCalls:0,productionTouched:false}));
}catch(error){
 await writeFile(join(stateDirectory,'route-hydration-'+run+'-errors.json'),JSON.stringify({navigations,errors,hydration:hydration.flat()},null,2)+'\n',{flag:'wx',mode:0o600});
 throw error;
}finally{await browser.close();}
