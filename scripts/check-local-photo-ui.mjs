// Read-only catalogue/cabinet plus an unsaved synthetic upload/crop in the original form.
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {join} from 'node:path';
import {chromium} from 'playwright';import sharp from 'sharp';
import {stateFile,stateDirectory,docker} from './local-primary-fixture.mjs';import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const state=readLocalPrimaryState(stateFile,process.cwd());validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const browser=await chromium.launch(),context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}}),page=await context.newPage();
const errors=[];page.on('pageerror',error=>errors.push(error.name));
async function frames(locator){
 const values=await locator.evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect(),img=node.querySelector('img');return{width:box.width,height:box.height,fit:img?getComputedStyle(img).objectFit:null};}));
 assert.ok(values.length);for(const value of values){assert.ok(Math.abs(value.width/value.height-4/3)<0.01,JSON.stringify(value));if(value.fit)assert.equal(value.fit,'cover');}
}
try{
 await page.goto(state.origin+'/obyavleniya');await page.locator('[data-listing-photo-frame]').first().waitFor();
 await frames(page.locator('[data-listing-photo-frame]'));await page.screenshot({path:'/tmp/blizhniy-photo-home.png',fullPage:true});
 const href=await page.locator('[data-listing-photo-frame]').first().locator('..').getAttribute('href');assert.match(href,/^\/obyavlenie\/[a-f0-9-]{36}$/);
 await page.goto(state.origin+href);await frames(page.locator('[data-listing-photo-frame]'));await page.screenshot({path:'/tmp/blizhniy-photo-detail.png',fullPage:true});
 const user=JSON.parse(await readFile(join(stateDirectory,'accounts.json'),'utf8')).find(item=>item.role==='user');
 await page.goto(state.origin+'/auth');await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByLabel('Пароль',{exact:true}).fill(user.password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(state.origin+'/');
 await page.goto(state.origin+'/cabinet/obyavleniya');await page.locator('article [data-listing-photo-frame]').first().waitFor();await frames(page.locator('article [data-listing-photo-frame]'));
 const boxes=await page.locator('article:has([data-listing-photo-frame])').evaluateAll(nodes=>nodes.map(node=>{const b=node.getBoundingClientRect();return{width:b.width,height:b.height};}));
 assert.ok(boxes.every(b=>Math.abs(b.width-boxes[0].width)<=1));assert.ok(Math.max(...boxes.map(b=>b.height))-Math.min(...boxes.map(b=>b.height))<=1,JSON.stringify(boxes));
 await page.screenshot({path:'/tmp/blizhniy-photo-cabinet.png',fullPage:true});
 await page.goto(state.origin+'/razmestit/obyavlenie');
 for(const width of [1024,1440]){
  await page.setViewportSize({width,height:1000});
  const button=await page.getByRole('button',{name:'Перейти к оплате',exact:true}).boundingBox(),note=await page.getByText('Объявление появится в каталоге после подтверждения оплаты. Сначала проверим поля и сохраним фотографии.',{exact:true}).boundingBox();
  assert.ok(button&&note);assert.ok(Math.abs(button.y+button.height/2-note.y-note.height/2)<=1,JSON.stringify({width,button,note}));
 }
 const pixels=await sharp({create:{width:600,height:900,channels:3,background:'#287950'}}).png().toBuffer();
 await page.getByLabel('Фотографии объявления',{exact:true}).setInputFiles({name:'portrait.png',mimeType:'image/png',buffer:pixels});
 await page.getByRole('button',{name:'Открыть файл 1',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Кадр',exact:true}).click();
 const crop=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Кадр для карточки',exact:true})});
 await crop.getByRole('button',{name:'Применить',exact:true}).click();await crop.waitFor({state:'detached'});
 const output=await page.getByLabel('Фотографии объявления',{exact:true}).evaluate(async input=>{const image=await createImageBitmap(input.files[0]);const result={width:image.width,height:image.height};image.close();return result;});
 assert.deepEqual(output,{width:1600,height:1200});
 await page.getByRole('button',{name:'Готово',exact:true}).click();
 assert.deepEqual(errors,[]);console.log(JSON.stringify({status:'passed',sameRatio:'4:3',cropOutput:'1600x1200',cover:true,uniformCabinet:true,buttonAlignment:true,savedPublication:false,productionTouched:false}));
}finally{await browser.close();}
