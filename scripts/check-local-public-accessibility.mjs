// Anonymous public pages on the owned synthetic stand; no accounts or payment actions.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {stateFile,stateDirectory,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';

const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const axePath=createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const paths=['/','/obyavleniya','/katalog','/rabota','/kak-rabotaet','/tarify','/o-proekte','/rekvizity','/auth',
 '/katalog/zhivotnye','/katalog/instrumenty','/katalog/posuda','/rabota/vakansii','/rabota/zakazy','/rabota/specialisty'];
const browser=await chromium.launch({headless:true}),results=[];
try{
 for(const width of [320,768,1440]){
  const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width,height:1000}});
  try{
   const page=await context.newPage();page.setDefaultTimeout(15000);
   for(const path of paths){
    const errors=[],onError=error=>errors.push(error.name);page.on('pageerror',onError);
    try{
     const response=await page.goto(state.origin+path,{waitUntil:'networkidle',timeout:30000});
     await page.addScriptTag({path:axePath});
     const checked=await page.evaluate(async()=>({
      overflow:document.documentElement.scrollWidth>innerWidth,
      violations:(await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations
       .filter(item=>['serious','critical'].includes(item.impact))
       .map(item=>({id:item.id,impact:item.impact,targets:item.nodes.map(node=>node.target)})),
     }));
     results.push({path,width,status:response.status(),errors,...checked});
    }finally{page.off('pageerror',onError);}
   }
  }finally{await context.close();}
 }
}finally{await browser.close();}
await writeFile(join(stateDirectory,'public-accessibility-'+randomUUID()+'.json'),JSON.stringify(results,null,2)+'\n',{flag:'wx',mode:0o600});
const failures=results.filter(result=>result.status!==200||result.errors.length||result.overflow||result.violations.length);
assert.deepEqual(failures,[],'Public page accessibility, runtime and responsive checks');
console.log(JSON.stringify({status:'passed',pages:paths.length,viewports:[320,768,1440],checks:results.length,axeSeriousCritical:0,productionTouched:false,paymentActions:false}));
