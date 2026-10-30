// Read-only browser acceptance against the owned loopback stand, never production.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {stateFile,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const browser=await chromium.launch({headless:true}),contexts=[];
const pause='Приостановить рекламную строку',resume='Включить движение рекламной строки';
async function open(options){
 const context=await browser.newContext({ignoreHTTPSErrors:true,...options});contexts.push(context);
 const page=await context.newPage();page.setDefaultTimeout(8000);
 await page.goto(state.origin+'/');const region=page.getByRole('region',{name:'Рекламная строка',exact:true});
 await region.waitFor();return {page,region};
}
async function staticState(region,width){
 const result=await region.evaluate((element)=>{
  const track=element.querySelector('.marquee-track'),style=getComputedStyle(track);
  return {animation:style.animationName,transform:style.transform,padding:style.paddingLeft,
   bounds:Array.from(element.querySelectorAll('.marquee-item'),item=>{const r=item.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};})};
 });
 assert.equal(result.animation,'none');assert.equal(result.transform,'none');assert.equal(result.padding,'0px');
 assert.ok(result.bounds.length>0);
 assert.ok(result.bounds.every(value=>value.left>=0&&value.right<=width+1&&value.width>0),'all stationary messages fit the viewport');
}
try{
 const desktop=await open({viewport:{width:1440,height:900},reducedMotion:'no-preference'});
 const control=desktop.region.getByRole('button',{name:pause,exact:true});
 await control.waitFor();await control.focus();await desktop.page.keyboard.press('Enter');
 await desktop.region.getByRole('button',{name:resume,exact:true}).waitFor();await staticState(desktop.region,1440);
 await desktop.page.keyboard.press('Enter');await desktop.region.getByRole('button',{name:pause,exact:true}).waitFor();
 const moving=await desktop.region.locator('.marquee-track').evaluate(element=>({name:getComputedStyle(element).animationName,state:getComputedStyle(element).animationPlayState}));
 assert.equal(moving.name,'marquee-scroll');assert.equal(moving.state,'running');
 const mobile=await open({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'no-preference'});
 const mobileControl=mobile.region.getByRole('button',{name:pause,exact:true});
 const box=await mobileControl.boundingBox();assert.ok(box&&box.width>=44&&box.height>=44);
 await mobileControl.tap();await mobile.region.getByRole('button',{name:resume,exact:true}).waitFor();await staticState(mobile.region,390);
 const reduced=await open({viewport:{width:320,height:800},reducedMotion:'reduce'});
 assert.equal(await reduced.region.getByRole('button',{name:pause,exact:true}).isVisible(),false);await staticState(reduced.region,320);
 await desktop.page.emulateMedia({reducedMotion:'reduce'});await staticState(desktop.region,1440);
 console.log('Local marquee passed: keyboard and touch stop/start, 44px control, reduced motion, readable stationary text at 320px.');
}finally{await Promise.allSettled(contexts.map(context=>context.close()));await browser.close();}
