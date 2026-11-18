// Owned loopback only; synthetic photos stay in unsaved forms, avatar changes are canceled.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {stateFile,stateDirectory,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const state=readLocalPrimaryState(stateFile,process.cwd());validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const role=process.argv[2]??'user';assert.ok(['user','admin'].includes(role),'only a seeded local account');
const browser=await chromium.launch(),context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}}),page=await context.newPage();
const errors=[],external=[],writes=[],results=[];let phase='login';
const axePath=createRequire(import.meta.url).resolve('axe-core/axe.min.js');
page.on('pageerror',error=>errors.push(error.name));page.setDefaultTimeout(15000);
page.on('request',request=>{const path=new URL(request.url()).pathname,method=request.method();if((['POST','PUT'].includes(method)&&/\/api\/account\/(listing-form|listing-checkout|work-form|work-checkout|media)$/.test(path))||(method==='PUT'&&path==='/api/account/profile'))writes.push(path);});
await context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==state.origin){external.push(url.host);return route.abort();}return route.continue();});
async function tabCycle(dialog){
 assert.equal(await dialog.evaluate(node=>node.contains(document.activeElement)),true,'modal receives initial focus');
 const controls=dialog.locator('button:enabled:visible, input:enabled:visible');
 if(!await controls.count()){await page.keyboard.press('Tab');assert.equal(await dialog.evaluate(node=>node.contains(document.activeElement)),true);await page.keyboard.press('Shift+Tab');assert.equal(await dialog.evaluate(node=>node.contains(document.activeElement)),true);return;}
 const first=controls.first(),last=controls.last();
 await last.focus();await page.keyboard.press('Tab');assert.equal(await first.evaluate(node=>node===document.activeElement),true,'Tab wraps to the first control');
 await first.focus();await page.keyboard.press('Shift+Tab');assert.equal(await last.evaluate(node=>node===document.activeElement),true,'Shift+Tab wraps to the last control');
}
async function audit(dialog){
 await dialog.evaluate(node=>Promise.allSettled(node.getAnimations({subtree:true}).map(animation=>animation.finished)));
 await page.addScriptTag({path:axePath});
 const failures=await dialog.evaluate(async node=>(await window.axe.run(node,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations.filter(row=>['serious','critical'].includes(row.impact)).map(row=>({id:row.id,targets:row.nodes.map(item=>item.target)})));
 assert.deepEqual(failures,[],'photo dialog accessibility');
}
async function moveAndReset(dialog){
 const down=dialog.getByRole('button',{name:'Сдвинуть фото вниз',exact:true});
 await page.waitForFunction(()=>[...document.querySelectorAll('dialog[open] button')].some(node=>node.getAttribute('aria-label')==='Сдвинуть фото вниз'&&!node.disabled));
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const image=dialog.locator('img').first(),top=await image.evaluate(node=>parseFloat(node.style.top));
 await down.focus();await page.keyboard.press('Enter');assert.ok(Math.abs((await image.evaluate(node=>parseFloat(node.style.top)))-top-10)<0.1);
 await dialog.getByRole('button',{name:'Сбросить',exact:true}).focus();await page.keyboard.press('Space');assert.ok(Math.abs((await image.evaluate(node=>parseFloat(node.style.top)))-top)<0.1);
}
const png=await sharp({create:{width:600,height:900,channels:3,background:'#287950'}}).png().toBuffer();
try{
 const user=JSON.parse(await readFile(join(stateDirectory,'accounts.json'),'utf8')).find(row=>row.role===role);
 await page.goto(state.origin+'/auth');await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByLabel('Пароль',{exact:true}).fill(user.password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(state.origin+'/');
 phase='listing';await page.goto(state.origin+'/razmestit/obyavlenie');
 await page.getByLabel('Фотографии объявления',{exact:true}).setInputFiles({name:'keyboard-portrait.png',mimeType:'image/png',buffer:png});
 for(const [width,height]of[[320,568],[768,700],[1440,900]]){
  phase='listing-'+width;await page.setViewportSize({width,height});
  const opener=page.getByRole('button',{name:'Открыть файл 1',exact:true});await opener.focus();await page.keyboard.press('Enter');
  const library=page.getByRole('dialog',{name:'Медиатека',exact:true});await tabCycle(library);await audit(library);
  const cropButton=library.getByRole('button',{name:'Кадр',exact:true});await cropButton.focus();await page.keyboard.press('Enter');
  const crop=page.getByRole('dialog',{name:'Кадр для карточки',exact:true});await moveAndReset(crop);await tabCycle(crop);await audit(crop);
  assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);
  assert.equal(await crop.evaluate(node=>{const box=node.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth+1;}),true);
  await page.keyboard.press('Escape');await crop.waitFor({state:'detached'});assert.equal(await cropButton.evaluate(node=>node===document.activeElement),true,'crop returns focus into its parent library');
  await tabCycle(library);await page.keyboard.press('Escape');await library.waitFor({state:'detached'});assert.equal(await opener.evaluate(node=>node===document.activeElement),true,'library returns focus to its opener');
  results.push({flow:'nested-listing',width});
 }
 phase='crop-output';await page.getByRole('button',{name:'Открыть файл 1',exact:true}).click();await page.getByRole('dialog',{name:'Медиатека',exact:true}).getByRole('button',{name:'Кадр',exact:true}).click();
 const crop=page.getByRole('dialog',{name:'Кадр для карточки',exact:true});await moveAndReset(crop);
 await page.evaluate(()=>{const OriginalImage=window.Image;window.__cropApply={pending:false,release:null};window.Image=function(...args){window.Image=OriginalImage;const image=new OriginalImage(...args);Object.defineProperty(image,'onload',{set(listener){image.addEventListener('load',event=>{window.__cropApply.pending=true;window.__cropApply.release=()=>listener.call(image,event);},{once:true});}});return image;};});
 phase='crop-output-apply';await crop.getByRole('button',{name:'Применить',exact:true}).click();phase='crop-output-pending';await page.waitForFunction(()=>window.__cropApply?.pending);
 await page.keyboard.press('Escape');assert.equal(await crop.isVisible(),true);assert.equal(await crop.getByRole('button',{name:'Закрыть редактор фото',exact:true}).isDisabled(),true);
 await tabCycle(crop);phase='crop-output-release';await page.evaluate(()=>window.__cropApply.release());await crop.waitFor({state:'detached'});
 const output=await page.getByLabel('Фотографии объявления',{exact:true}).evaluate(async node=>{const image=await createImageBitmap(node.files[0]);const size={width:image.width,height:image.height};image.close();return size;});assert.deepEqual(output,{width:1600,height:1200});
 await page.getByRole('dialog',{name:'Медиатека',exact:true}).getByRole('button',{name:'Готово',exact:true}).click();await page.getByRole('button',{name:'Удалить файл 1',exact:true}).click();
 phase='order';await page.goto(state.origin+'/rabota/zakazy/sozdat');await page.locator('input[type=file]').setInputFiles({name:'order-keyboard.png',mimeType:'image/png',buffer:png});
 await page.getByRole('button',{name:'Изменить кадр',exact:true}).first().click();const orderCrop=page.getByRole('dialog',{name:'Кадр для карточки',exact:true});await moveAndReset(orderCrop);await tabCycle(orderCrop);await audit(orderCrop);await page.keyboard.press('Escape');await orderCrop.waitFor({state:'detached'});
 await page.getByRole('button',{name:'Убрать order-keyboard.png',exact:true}).click();results.push({flow:'order-crop'});
 phase='avatar';await page.goto(state.origin+'/cabinet');await page.getByRole('button',{name:'Настройки',exact:true}).click();
 const avatarOpener=page.getByRole('button',{name:'Выбрать',exact:true});await avatarOpener.focus();await page.locator('input[type=file]').setInputFiles({name:'avatar-keyboard.png',mimeType:'image/png',buffer:png});
 const avatar=page.getByRole('dialog',{name:'Выберите область аватарки',exact:true});await moveAndReset(avatar);await tabCycle(avatar);await audit(avatar);await page.keyboard.press('Escape');await avatar.waitFor({state:'detached'});assert.equal(await avatarOpener.evaluate(node=>node===document.activeElement),true);results.push({flow:'avatar-cancel'});
 phase='gallery';
 let galleryUrl, catalogPath='/rabota/zakazy';
 const visited=new Set(), deadline=performance.now()+60_000;
 while(catalogPath&&!galleryUrl){
  assert.ok(performance.now()<deadline,'find a published two-photo fixture within one minute');
  assert.ok(!visited.has(catalogPath),'catalog pagination advances');visited.add(catalogPath);
  await page.goto(state.origin+catalogPath);
  const links=await page.locator('a[href^="/rabota/zakazy/"]').evaluateAll(nodes=>[...new Set(nodes.map(node=>node.getAttribute('href')).filter(href=>/^\/rabota\/zakazy\/[a-f0-9-]{36}$/.test(href)))]);
  const next=page.getByRole('navigation',{name:'Страницы заказов',exact:true}).getByRole('link',{name:'Далее',exact:true});
  catalogPath=await next.count()?await next.getAttribute('href'):null;
  if(catalogPath)assert.match(catalogPath,/^\/rabota\/zakazy\?page=\d+$/);
  for(const link of links){
   assert.ok(performance.now()<deadline,'find a published two-photo fixture within one minute');
   await page.goto(state.origin+link);if(await page.getByRole('button',{name:'Показать фото 2',exact:true}).count()){galleryUrl=link;break;}}
 }
 assert.ok(galleryUrl,'owned fixture needs a published order with two photos');
 for(const width of [320,1440]){
  await page.setViewportSize({width,height:700});await page.goto(state.origin+galleryUrl);
  const open=page.getByRole('button',{name:/^Открыть фото:/});await open.focus();await page.keyboard.press('Enter');const gallery=page.getByRole('dialog');await tabCycle(gallery);await audit(gallery);
  await gallery.locator('img').waitFor();assert.equal(await gallery.locator('[aria-live=polite]').count(),1);const first=await gallery.locator('img').getAttribute('src');await page.keyboard.press('ArrowRight');await page.waitForFunction(old=>document.querySelector('dialog[open] img')?.getAttribute('src')!==old,first);
  await gallery.getByRole('button',{name:'Следующее фото',exact:true}).focus();await page.keyboard.press('Space');await page.keyboard.press('Escape');await gallery.waitFor({state:'detached'});assert.equal(await open.evaluate(node=>node===document.activeElement),true);
  results.push({flow:'public-gallery',width});
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(writes,[]);
 console.log(JSON.stringify({status:'passed',role,results,cropOutput:output,savedPublication:false,savedAvatar:false,pageErrors:0,external:0}));
}catch(error){console.error(JSON.stringify({status:'failed',phase,error:error?.name,...(error?.code==='ERR_ASSERTION'?{check:error.message.slice(0,800)}:{}),...(phase.startsWith('crop-output')?{cropError:await page.locator('dialog [role=alert]').allTextContents()}: {})}));process.exitCode=1;}
finally{await context.close();await browser.close();}
