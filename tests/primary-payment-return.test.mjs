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
 const {default:Page}=load('src/app/oplata/[paymentId]/page.tsx',{'@/components/payments/PaymentReturnClient':{PaymentReturnClient:()=>React.createElement('p',null,'legacy')},'@/components/payments/PrimaryPaymentReturnClient':{PrimaryPaymentReturnClient:()=>React.createElement('p',null,'primary')}});
 const previous=process.env.BLIZHNIY_AUTH_MODE;
 try{for(const mode of ['postgres','unknown','local','']){process.env.BLIZHNIY_AUTH_MODE=mode;assert.equal(renderToStaticMarkup(await Page({params:Promise.resolve({paymentId:'synthetic'})})),`<p>${!mode||mode==='local'?'legacy':'primary'}</p>`);}}
 finally{if(previous===undefined)delete process.env.BLIZHNIY_AUTH_MODE;else process.env.BLIZHNIY_AUTH_MODE=previous;}
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
