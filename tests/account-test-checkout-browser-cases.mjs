import assert from 'node:assert/strict';import {createRequire} from 'node:module';
export async function testAccountCheckoutBrowser({context,page,origin,owner,id,revision,title}){
 const paymentId='a2345678-1234-4321-8765-123456789abc',calls=[];let saved=null,losePreview=true,losePrepare=true,loseDispatch=true,status='created';
 await context.route('**/api/account/listing-checkout',async route=>{
  const request=route.request(),body=request.postDataJSON();calls.push({method:request.method(),body});assert.equal(body.expectedOwnerId,owner);
  if(request.method()==='PUT'){
   assert.equal(body.listingId,id);assert.equal(body.expectedRevision,revision);assert.equal(body.expectedTariffId,'listing-standard');assert.equal(body.expectedAmount,'199.99');assert.equal(body.expectedDurationDays,30);
   assert.equal(saved,null);saved={id:paymentId,creationKey:body.creationKey,targetId:id,targetRevision:revision,tariffId:body.expectedTariffId,amount:body.expectedAmount,durationDays:body.expectedDurationDays,status,createdAt:'2026-10-20T12:00:00.123456Z'};
   if(losePrepare){losePrepare=false;return route.abort();}return route.fulfill({json:saved});
  }
  if(body.action==='testPreview'){
   assert.equal(request.method(),'POST');
   assert.equal(body.listingId,id);assert.equal(body.expectedRevision,revision);
   if(losePreview){losePreview=false;return route.fulfill({status:503,json:{error:{code:'CHECKOUT_UNAVAILABLE'}}});}
   return route.fulfill({json:{listingId:id,revision,tariff:{id:'listing-standard',name:'Размещение',amount:'199.99',currency:'RUB',durationDays:30},activePayment:null}});
  }
  if(body.action==='intent'){assert.equal(body.creationKey,saved.creationKey);return route.fulfill({json:saved});}
  if(body.action==='order'){assert.equal(body.paymentId,paymentId);return route.fulfill({json:{order:{...saved,status},fulfillment:null}});}
  assert.equal(body.action,'dispatch');assert.equal(body.paymentId,paymentId);
  if(loseDispatch){loseDispatch=false;return route.abort();}
  return route.fulfill({json:{confirmationUrl:'https://yoomoney.ru/checkout',isTest:true}});
 });
 // Synthetic approved external destination only. No real provider traffic from this regression test.
 await context.route('https://yoomoney.ru/checkout',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ru"><title>TEST checkout</title><body><h1>Изолированный TEST checkout</h1></body></html>'}));
 const card=page.getByRole('link',{name:title,exact:true}).locator('xpath=ancestor::li[1]');
 await card.getByRole('button',{name:'Статус и оплата',exact:true}).click();await page.getByText('Одобрено модератором',{exact:true}).waitFor();assert.equal(calls.length,0);
 await page.getByRole('button',{name:'Оплатить размещение',exact:true}).click();await page.getByRole('region',{name:'Оплата объявления',exact:true}).getByRole('alert').waitFor();
 assert.equal(await page.getByRole('heading',{name:'Тестирование оплаты',exact:true}).count(),0);assert.equal(calls.filter(call=>call.method==='PUT').length,0);
 await page.getByRole('button',{name:'Оплатить размещение',exact:true}).focus();await page.keyboard.press('Space');await page.getByRole('heading',{name:'Тестирование оплаты',exact:true}).waitFor();
 await page.getByText('TEST-заказ: 199,99 ₽ за 30 дн. Реальные деньги не списываются, публикация не выполняется.',{exact:true}).waitFor();
 assert.equal(calls.filter(call=>call.body.action==='testPreview').length,2);
 await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
 for(const width of [320,768,1024,1440]){
  await page.setViewportSize({width,height:900});assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);
  assert.deepEqual(await page.evaluate(async()=>{const result=await window.axe.run(document.querySelector('section[aria-label="Оплата объявления"]'));return result.violations.filter(row=>['serious','critical'].includes(row.impact)).map(row=>row.id);}),[]);
 }
 await page.getByRole('button',{name:'Создать TEST-заказ',exact:true}).focus();await page.keyboard.press('Space');
 await page.getByRole('button',{name:'Проверить сохранённый заказ',exact:true}).waitFor();assert.equal(calls.filter(call=>call.method==='PUT').length,1);
 let release;const gate=new Promise(resolve=>{release=resolve;});
 await context.route('**/api/account/session',async route=>{await gate;return route.fulfill({json:{user:{id:owner,email:'fixture@example.invalid',role:'user',isBlocked:false}}});});
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.getByText('Проверяем доступ к черновикам…',{exact:true}).waitFor();release();
 await page.getByRole('button',{name:'Проверить сохранённый заказ',exact:true}).waitFor();
 assert.equal(calls.filter(call=>call.method==='PUT').length,1);
 await page.getByRole('button',{name:'Проверить сохранённый заказ',exact:true}).click();await page.waitForURL(origin+'/oplata/'+paymentId);
 await page.getByRole('heading',{name:'Заказ подготовлен',exact:true}).waitFor();assert.equal(calls.filter(call=>call.body.action==='dispatch').length,0);
 await page.getByRole('button',{name:'Перейти в ЮKassa (TEST)',exact:true}).click();await page.getByRole('button',{name:'Восстановить переход к оплате',exact:true}).waitFor();
 await page.getByRole('alert').filter({hasText:'Переход не подтверждён'}).waitFor();
 await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
 for(const width of [320,768,1024,1440]){
  await page.setViewportSize({width,height:900});assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);
  assert.deepEqual(await page.evaluate(async()=>{const result=await window.axe.run(document.querySelector('section[aria-label="Переход в TEST-оплату"]'));return result.violations.filter(row=>['serious','critical'].includes(row.impact)).map(row=>row.id);}),[]);
 }
 await page.getByRole('region',{name:'Статус оплаты',exact:true}).screenshot({path:'/tmp/blizhniy-account-test-checkout.png'});
 await page.getByRole('button',{name:'Восстановить переход к оплате',exact:true}).click();await page.waitForURL('https://yoomoney.ru/checkout');
 assert.equal(calls.filter(call=>call.method==='PUT').length,1);assert.equal(calls.filter(call=>call.body.action==='dispatch').length,2);
 status='succeeded';await page.goto(origin+'/oplata/'+paymentId);await page.getByRole('heading',{name:'Оплата подтверждена',exact:true}).waitFor();
 await page.getByText('TEST-платёж успешно проверен. Реальные деньги не списывались. Объявление не публикуется за тестовую оплату.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Перейти в ЮKassa (TEST)',exact:true}).count(),0);assert.equal(calls.filter(call=>call.body.action==='dispatch').length,2);
}
