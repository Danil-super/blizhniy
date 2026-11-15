// Owned loopback only; reference failures are simulated in the browser, no form is saved.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {stateFile,stateDirectory,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const state=readLocalPrimaryState(stateFile,process.cwd());validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const browser=await chromium.launch(),context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}}),page=await context.newPage();
let phase='login',holdNext=false,held;const errors=[],external=[],writes=[],results=[],axePath=createRequire(import.meta.url).resolve('axe-core/axe.min.js');page.setDefaultTimeout(10000);
page.on('pageerror',error=>errors.push(error.name));
page.on('request',request=>{const path=new URL(request.url()).pathname;if((request.method()==='PUT'&&/\/api\/account\/(work-publications|service-publications)$/.test(path))||(request.method()==='POST'&&/\/api\/account\/(work-checkout|listing-checkout|media)$/.test(path)))writes.push(path);});
await context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==state.origin){external.push(url.host);return route.abort();}return route.continue();});
await context.route('**/api/reference/professions',route=>{if(holdNext){holdNext=false;held=route;return;}return route.continue();});
async function audit(root){await page.addScriptTag({path:axePath});const issues=await root.evaluate(async node=>(await window.axe.run(node,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations.filter(row=>['serious','critical'].includes(row.impact)).map(row=>({id:row.id,targets:row.nodes.map(item=>item.target)})));assert.deepEqual(issues,[]);}
try{
 const user=JSON.parse(await readFile(join(stateDirectory,'accounts.json'),'utf8')).find(row=>row.role==='user');
 await page.goto(state.origin+'/auth');await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByLabel('Пароль',{exact:true}).fill(user.password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(state.origin+'/');
 for(const width of [320,768,1440]){
  phase='ready-'+width;await page.setViewportSize({width,height:900});await page.goto(state.origin+'/rabota/zakazy/sozdat');
  const input=page.getByRole('combobox',{name:'Профессия / специализация',exact:true}),root=input.locator('..').locator('..'),primary=root.locator('..'),id=page.locator('input[name="professionId"]');
  await page.locator('input[name="profession"][data-reference-state="empty"]').waitFor();await input.focus();await root.getByRole('option').first().click();const savedId=await id.inputValue();assert.ok(savedId);await input.press('ArrowDown');await input.press('ArrowDown');
  assert.equal(await input.evaluate(node=>document.getElementById(node.getAttribute('aria-activedescendant'))?.getAttribute('aria-selected')), 'false');await audit(root);
  phase='loading-'+width;holdNext=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.locator('input[name="profession"][data-reference-state="loading"]').waitFor();assert.ok(held);
  assert.equal(await input.getAttribute('aria-expanded'),'false');assert.equal(await input.getAttribute('aria-activedescendant'),null);assert.equal(await root.getByRole('listbox').count(),0);
  await input.press('ArrowDown');await input.press('Enter');assert.equal(await id.inputValue(),savedId);assert.equal(await input.evaluate(node=>node.checkValidity()),false);await root.getByRole('alert').waitFor();assert.match(await root.getByRole('alert').textContent(),/загрузки/);await audit(root);
  phase='error-'+width;await held.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'SYNTHETIC_UNAVAILABLE'})});held=null;
  await page.locator('input[name="profession"][data-reference-state="error"]').waitFor();assert.equal(await input.getAttribute('aria-expanded'),'false');assert.equal(await input.getAttribute('aria-activedescendant'),null);await input.press('Enter');assert.equal(await id.inputValue(),savedId);assert.match(await root.getByRole('alert').textContent(),/ещё раз/);assert.equal(await input.evaluate(node=>node.checkValidity()),false);await audit(root);
  phase='retry-'+width;await primary.getByRole('button',{name:'Повторить',exact:true}).click();await page.locator('input[name="profession"][data-reference-state="selected"]').waitFor();assert.equal(await id.inputValue(),savedId);assert.equal(await input.evaluate(node=>node.checkValidity()),true);assert.equal(await root.getByRole('alert').count(),0);assert.equal(await input.getAttribute('aria-invalid'),null);
  await input.focus();await input.press('ArrowDown');await root.getByRole('listbox').waitFor();assert.equal(await input.evaluate(node=>Boolean(document.getElementById(node.getAttribute('aria-activedescendant')))),true);await input.press('Escape');assert.equal(await input.getAttribute('aria-expanded'),'false');assert.equal(await id.inputValue(),savedId);
  assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);results.push({width,loading:true,error:true,retry:true,uuidPreserved:true});
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(writes,[]);console.log(JSON.stringify({status:'passed',results,pageErrors:0,external:0,savedPublication:false}));
}catch(error){console.error(JSON.stringify({status:'failed',phase,error:error?.name,check:error?.code==='ERR_ASSERTION'?error.message.slice(0,800):String(error?.message).split('\n')[0].slice(0,400)}));process.exitCode=1;}
finally{await context.close();await browser.close();}
