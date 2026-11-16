// Owned loopback only. Values remain in an unsaved publication form.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {stateFile,stateDirectory,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const state=readLocalPrimaryState(stateFile,process.cwd());validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const browser=await chromium.launch(),context=await browser.newContext({ignoreHTTPSErrors:true,hasTouch:true,viewport:{width:1440,height:900}}),page=await context.newPage();
const errors=[],external=[],writes=[],results=[];let phase='login';page.setDefaultTimeout(10000);
const axePath=createRequire(import.meta.url).resolve('axe-core/axe.min.js');
page.on('pageerror',error=>errors.push(error.name));
page.on('request',request=>{const path=new URL(request.url()).pathname;if(request.method()==='POST'&&/\/api\/account\/(listing-form|listing-checkout|media)$/.test(path))writes.push(path);});
await context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==state.origin){external.push(url.host);return route.abort();}return route.continue();});
const formValue=name=>page.locator('form').filter({has:page.locator('input[name="kind"]')}).evaluate((form,name)=>new FormData(form).get(name),name);
async function focused(locator){const node=await locator.elementHandle();assert.ok(node);try{await page.waitForFunction(node=>node===document.activeElement,node,{timeout:3000});}finally{await node.dispose();}}
async function audit(root){
 await page.addScriptTag({path:axePath});await root.evaluate(node=>Promise.allSettled(node.getAnimations({subtree:true}).map(animation=>animation.finished)));
 const failures=await root.evaluate(async node=>(await window.axe.run(node,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations.filter(row=>['serious','critical'].includes(row.impact)).map(row=>({id:row.id,targets:row.nodes.map(item=>item.target)})));
 assert.deepEqual(failures,[],'dropdown accessibility');
}
try{
 const user=JSON.parse(await readFile(join(stateDirectory,'accounts.json'),'utf8')).find(row=>row.role==='user');
 await page.goto(state.origin+'/auth');await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByLabel('Пароль',{exact:true}).fill(user.password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(state.origin+'/');
 for(const width of [320,768,1440]){
  phase='kind-'+width;await page.setViewportSize({width,height:900});await page.goto(state.origin+'/razmestit/obyavlenie');
  const root=page.locator('input[type=hidden][name="kind"]').locator('..'),trigger=root.locator(':scope > button');await trigger.waitFor();const before=await formValue('kind');
  await trigger.focus();await page.keyboard.press('ArrowDown');let list=root.getByRole('listbox');await list.waitFor({timeout:3000});await focused(list.getByRole('option',{selected:true}));
  await page.keyboard.press('End');await focused(list.getByRole('option').last());assert.equal(await formValue('kind'),before);await audit(root);
  await page.keyboard.press('Escape');await list.waitFor({state:'detached'});await focused(trigger);assert.equal(await formValue('kind'),before);
  await page.keyboard.press('Space');list=root.getByRole('listbox');await list.waitFor();await page.keyboard.press('End');await page.keyboard.press('Enter');await list.waitFor({state:'detached'});await focused(trigger);const chosen=await formValue('kind');assert.notEqual(chosen,before);
  await page.keyboard.press('Home');list=root.getByRole('listbox');await list.waitFor();await focused(list.getByRole('option').first());await page.keyboard.press('Tab');await list.waitFor({state:'detached'});assert.equal(await formValue('kind'),chosen);await focused(page.locator('.listing-category-field button[aria-haspopup="listbox"]'));
  await trigger.focus();await page.keyboard.press('Space');await root.getByRole('listbox').waitFor();await page.keyboard.press('Shift+Tab');await root.getByRole('listbox').waitFor({state:'detached'});await focused(trigger);
  await trigger.focus();const keyboardSession=await context.newCDPSession(page);await keyboardSession.send('Input.dispatchKeyEvent',{type:'keyDown',key:'П',code:'KeyG'});await keyboardSession.send('Input.dispatchKeyEvent',{type:'keyUp',key:'П',code:'KeyG'});await keyboardSession.detach();list=root.getByRole('listbox');await list.waitFor();assert.match(await list.evaluate(node=>node.contains(document.activeElement)?document.activeElement.textContent:''),/^П/i);await page.keyboard.press('Escape');await focused(trigger);
  phase='city-'+width;const city=page.locator('input[type=hidden][name="location"]').locator('..'),cityButton=city.locator(':scope > button'),proxy=city.locator('input[required]');
  assert.equal(await formValue('location'),'');assert.equal(await proxy.evaluate(node=>node.willValidate),true);assert.equal(await proxy.evaluate(node=>node.checkValidity()),false);
  await city.getByRole('alert').waitFor();list=city.getByRole('listbox');await list.waitFor();assert.equal(await cityButton.getAttribute('aria-describedby'),await city.getByRole('alert').getAttribute('id'));
  await page.keyboard.press('Home');await page.keyboard.press('Enter');await list.waitFor({state:'detached'});const cityValue=await formValue('location');assert.ok(cityValue);assert.equal(await proxy.evaluate(node=>node.checkValidity()),true);assert.equal(await city.getByRole('alert').count(),0);
  await cityButton.click();list=city.getByRole('listbox');await list.waitFor();await audit(city);
  await list.evaluate(node=>{node.scrollIntoView({block:'center',behavior:'instant'});node.scrollTop=0;});
  const box=await list.boundingBox();assert.ok(box&&box.height>160);assert.equal(await list.evaluate((node,point)=>node.contains(document.elementFromPoint(point.x,point.y)),{x:box.x+box.width/2,y:box.y+box.height-25}),true,'gesture must start inside the visible options');const cdp=await context.newCDPSession(page);
  const point={x:box.x+box.width/2,y:box.y+box.height-25};await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
  for(let step=1;step<=6;step++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x,y:point.y-step*20}]});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  assert.equal(await list.isVisible(),true,'touch scrolling must not select an option');assert.equal(await formValue('location'),cityValue);assert.ok(await list.evaluate(node=>node.scrollTop)>0,'gesture scrolls the options');
  await page.keyboard.press('Escape');await list.waitFor({state:'detached'});await focused(cityButton);
  assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);results.push({width,keyboard:true,required:true,touchScroll:true});
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(writes,[]);console.log(JSON.stringify({status:'passed',results,pageErrors:0,external:0,savedPublication:false}));
}catch(error){console.error(JSON.stringify({status:'failed',phase,error:error?.name,check:error?.code==='ERR_ASSERTION'?error.message.slice(0,800):String(error?.message).split('\n')[0].slice(0,400)}));process.exitCode=1;}
finally{await context.close();await browser.close();}
