import assert from 'node:assert/strict';import {test} from 'node:test';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
function load(path,deps){const exports={};new Function('require','exports',ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(name=>{if(name==='react'||name==='react/jsx-runtime')return require(name);if(Object.hasOwn(deps,name))return deps[name];throw Error('Unapproved payment UI dependency: '+name);},exports);return exports;}
test('payment result distinguishes preparation, confirmed finance and actual fulfillment without promising current publication',()=>{
 const {ListingPaymentStatus}=load('src/components/payments/ListingPaymentStatus.tsx',{});
 const base={order:{status:'created',amount:'199.99',durationDays:30},fulfillment:null};
 const html=value=>renderToStaticMarkup(React.createElement(ListingPaymentStatus,{snapshot:value}));
 assert.match(html(base),/Заказ подготовлен/);assert.match(html(base),/ещё не начат/);
 assert.match(html({...base,order:{...base.order,status:'pending'}}),/Платёж обрабатывается/);
 assert.match(html({...base,order:{...base.order,status:'succeeded'}}),/Оплата подтверждена/);
 assert.match(html({...base,order:{...base.order,status:'succeeded'},fulfillment:{publishedAt:'2026-10-19T12:00:00.123456Z',expiresAt:'2026-11-18T12:00:00.123456Z'}}),/Размещение выполнено/);
 assert.match(html({...base,order:{...base.order,status:'failed'}}),/Платёж отменён/);
 assert.match(html({...base,order:{...base.order,status:'refunded'},fulfillment:{publishedAt:'2026-10-19T12:00:00.123456Z',expiresAt:'2026-11-18T12:00:00.123456Z'}}),/Средства возвращены/);
});
test('primary return page never mounts the legacy payment component in postgres or unknown auth modes',async()=>{
 const {default:Page}=load('src/app/oplata/[paymentId]/page.tsx',{'@/lib/specialist-checkout-config':{readSpecialistCheckoutEnabled:()=>false},'@/components/payments/PaymentReturnClient':{PaymentReturnClient:()=>React.createElement('p',null,'legacy')},'@/components/payments/PrimaryPaymentReturnClient':{PrimaryPaymentReturnClient:()=>React.createElement('p',null,'primary')},'@/components/payments/ApplicationPaymentReturnClient':{ApplicationPaymentReturnClient:()=>React.createElement('p',null,'application')},'@/lib/checkout-cancellation-policy':{readCheckoutCancellationPolicy:()=>null},'@/lib/listing-workflow-config':load('src/lib/listing-workflow-config.ts',{})});
 const previous=process.env.BLIZHNIY_AUTH_MODE,checkout=process.env.BLIZHNIY_LISTING_CHECKOUT;
 process.env.BLIZHNIY_LISTING_CHECKOUT='prepare-only';
 try{for(const mode of ['postgres','unknown','local','']){process.env.BLIZHNIY_AUTH_MODE=mode;assert.equal(renderToStaticMarkup(await Page({params:Promise.resolve({paymentId:'synthetic'})})),`<p>${!mode||mode==='local'?'legacy':'primary'}</p>`);}}
 finally{if(previous===undefined)delete process.env.BLIZHNIY_AUTH_MODE;else process.env.BLIZHNIY_AUTH_MODE=previous;if(checkout===undefined)delete process.env.BLIZHNIY_LISTING_CHECKOUT;else process.env.BLIZHNIY_LISTING_CHECKOUT=checkout;}
});
test('specialist return preserves its target when disabled and never offers unsupported cancellation or dispatch',async()=>{
 const names=['BLIZHNIY_AUTH_MODE','BLIZHNIY_LISTING_PAYMENT'],before=Object.fromEntries(names.map(name=>[name,process.env[name]]));let enabled=false,cancellationPolicy={listing:{shopId:'synthetic'}};
 const {default:Page}=load('src/app/oplata/[paymentId]/page.tsx',{
  '@/components/payments/PaymentReturnClient':{PaymentReturnClient:()=>null},'@/components/payments/PrimaryPaymentReturnClient':{PrimaryPaymentReturnClient:()=>null},
  '@/components/payments/ApplicationPaymentReturnClient':{ApplicationPaymentReturnClient:()=>null},'@/lib/checkout-cancellation-policy':{readCheckoutCancellationPolicy:()=>cancellationPolicy},
  '@/lib/listing-workflow-config':{readPostmoderationEnabled:()=>true},'@/lib/specialist-checkout-config':{readSpecialistCheckoutEnabled:()=>enabled},
 });
 try{
  process.env.BLIZHNIY_AUTH_MODE='postgres';process.env.BLIZHNIY_LISTING_PAYMENT='account-publication-test';
  const props=()=>Page({params:Promise.resolve({paymentId:'11111111-1111-4111-8111-111111111111'}),searchParams:Promise.resolve({type:'specialist'})});
  const disabled=await props();assert.equal(disabled.props.specialist,true);assert.equal(disabled.props.testCheckout,false);assert.equal(disabled.props.cancellationEnabled,false);
  enabled=true;const active=await props();assert.equal(active.props.specialist,true);assert.equal(active.props.testCheckout,true);assert.equal(active.props.cancellationEnabled,false);
  cancellationPolicy={specialist:{shopId:'synthetic'}};assert.equal((await props()).props.cancellationEnabled,true);
 }finally{for(const name of names){if(before[name]===undefined)delete process.env[name];else process.env[name]=before[name];}}
});
test('TEST success explains that real money and production publication are not involved',()=>{
 const {ListingPaymentStatus}=load('src/components/payments/ListingPaymentStatus.tsx',{});
 const snapshot={order:{status:'succeeded',amount:'199.99',durationDays:30},fulfillment:null};
 const testHtml=renderToStaticMarkup(React.createElement(ListingPaymentStatus,{snapshot,testMode:true}));
 assert.match(testHtml,/TEST-платёж успешно проверен/);assert.match(testHtml,/Реальные деньги не списывались/);
 assert.match(testHtml,/Объявление не публикуется за тестовую оплату/);assert.doesNotMatch(testHtml,/проверьте статус позже/);
 const ordinaryHtml=renderToStaticMarkup(React.createElement(ListingPaymentStatus,{snapshot}));
 assert.match(ordinaryHtml,/Размещение ещё не подтверждено/);assert.doesNotMatch(ordinaryHtml,/TEST-платёж/);
});

test('payment results name the placement that the owner paid for', () => {
 const {ListingPaymentStatus}=load('src/components/payments/ListingPaymentStatus.tsx',{});
 for(const [target,subject,genitive] of [
  ['listing','Объявление','объявления'],['vacancy','Вакансия','вакансии'],
  ['workRequest','Заказ','заказа'],['specialist','Анкета','анкеты'],
 ]){
  for(const [status,fulfilled,expected] of [
   ['refunded',true,'состояние '+genitive],['failed',false,'состояние '+genitive],
   ['succeeded',true,'состояние '+genitive],['succeeded',false,subject+' не публикуется за тестовую оплату'],
  ]){
   const snapshot={order:{status,amount:'199.00',durationDays:30},fulfillment:fulfilled?{publishedAt:'2026-11-01',expiresAt:'2026-12-01'}:null};
   const html=renderToStaticMarkup(React.createElement(ListingPaymentStatus,{snapshot,target,testMode:!fulfilled}));
   assert.ok(html.includes(expected),target+' '+status+' '+expected);
  }
 }
});

test('a specialist bookmark keeps its identity even with the whole postmoderation workflow off',async()=>{
 const previous=process.env.BLIZHNIY_AUTH_MODE;
 try{
  process.env.BLIZHNIY_AUTH_MODE='postgres';
  const primary=()=>null;
  const {default:Page}=load('src/app/oplata/[paymentId]/page.tsx',{
   '@/components/payments/PaymentReturnClient':{PaymentReturnClient:()=>null},
   '@/components/payments/PrimaryPaymentReturnClient':{PrimaryPaymentReturnClient:primary},
   '@/components/payments/ApplicationPaymentReturnClient':{ApplicationPaymentReturnClient:()=>null},
   '@/lib/listing-workflow-config':{readPostmoderationEnabled:()=>false},
   '@/lib/specialist-checkout-config':{readSpecialistCheckoutEnabled:()=>true},
   '@/lib/checkout-cancellation-policy':{readCheckoutCancellationPolicy:()=>({listing:{shopId:'synthetic'}})},
  });
  const result=await Page({params:Promise.resolve({paymentId:'22222222-2222-4222-8222-222222222222'}),searchParams:Promise.resolve({type:'specialist'})});
  assert.equal(result.type,primary);assert.equal(result.props.specialist,true);assert.equal(result.props.testCheckout,false);assert.equal(result.props.cancellationEnabled,false);
 }finally{if(previous===undefined)delete process.env.BLIZHNIY_AUTH_MODE;else process.env.BLIZHNIY_AUTH_MODE=previous;}
});

test('closed hosted checkout shows saved receipts while active and local placements keep their return screen', async () => {
 const primary = () => null, history = () => null;
 let postmoderation = true;
 const {default: Page} = load('src/app/oplata/[paymentId]/page.tsx', {
  '@/components/payments/PaymentReturnClient': {PaymentReturnClient: () => null},
  '@/components/payments/PrimaryPaymentReturnClient': {PrimaryPaymentReturnClient: primary},
  '@/components/payments/ApplicationPaymentReturnClient': {ApplicationPaymentReturnClient: () => null},
  '@/components/cabinet/PrimaryPaymentHistory': {PrimaryPaymentHistory: history},
  '@/lib/listing-workflow-config': {readPostmoderationEnabled: () => postmoderation},
  '@/lib/specialist-checkout-config': {readSpecialistCheckoutEnabled: () => false},
  '@/lib/checkout-cancellation-policy': {readCheckoutCancellationPolicy: () => null},
 });
 const keys = ['BLIZHNIY_AUTH_MODE', 'BLIZHNIY_LISTING_CHECKOUT', 'BLIZHNIY_LOCAL_PRIMARY'];
 const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
 const id = '11111111-1111-4111-8111-111111111111';
 const open = type => Page({params: Promise.resolve({paymentId: id}), searchParams: Promise.resolve({type})});
 try {
  process.env.BLIZHNIY_AUTH_MODE = 'postgres';
  delete process.env.BLIZHNIY_LOCAL_PRIMARY;
  for (const type of [undefined, 'listing', 'vacancy', 'workRequest']) {
   for (const closed of [undefined, 'disabled']) {
    if (closed === undefined) delete process.env.BLIZHNIY_LISTING_CHECKOUT;
    else process.env.BLIZHNIY_LISTING_CHECKOUT = closed;
    for (const workflowEnabled of [false, true]) {
     postmoderation = workflowEnabled;
     const view = (await open(type)).props.children[1];
     assert.equal(view.type, history);
     assert.deepEqual(view.props.receipt, {id, targetType: type ?? 'listing'});
    }
   }
   postmoderation = true;
   process.env.BLIZHNIY_LISTING_CHECKOUT = 'prepare-only';
   assert.equal((await open(type)).type, primary);
   process.env.BLIZHNIY_LOCAL_PRIMARY = 'enabled';
   delete process.env.BLIZHNIY_LISTING_CHECKOUT;
   assert.equal((await open(type)).type, primary);
   delete process.env.BLIZHNIY_LOCAL_PRIMARY;
  }
 } finally {
  for (const key of keys) {
   if (before[key] === undefined) delete process.env[key];
   else process.env[key] = before[key];
  }
 }
});

test('pending payment instructions distinguish active polling from manual recovery',()=>{
 const {ListingPaymentStatus}=load('src/components/payments/ListingPaymentStatus.tsx',{});
 const snapshot={order:{status:'pending',amount:'199.00',durationDays:30},fulfillment:null};
 for(const checkingAutomatically of [true,false]){
  const html=renderToStaticMarkup(React.createElement(ListingPaymentStatus,{snapshot,checkingAutomatically}));
  assert.match(html,/Повторно платить не нужно/);
  assert.ok(html.includes('Проверяем статус автоматически')===checkingAutomatically);
  assert.ok(html.includes('Проверить статус')===!checkingAutomatically);
 }
});
