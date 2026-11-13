import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require=createRequire(import.meta.url),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
function load(file,substitutions){
 const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(js,{module,exports:module.exports,require:name=>Object.hasOwn(substitutions,name)?substitutions[name]:require(name)});
 return module.exports;
}
function shell(){
 return load('src/components/DashboardShell.tsx',{
  '@/components/SiteHeader':{SiteHeader:()=>React.createElement('header',{'data-header':true})},
  '@/components/cabinet/CabinetProfileBar':{CabinetProfileBar:()=>React.createElement('section',{'data-profile':true})},
  '@/components/cabinet/CabinetShellActions':{CabinetShellActions:()=>React.createElement('div',{'data-actions':true})},
 });
}

test('cabinet shell preserves its single profile area and active section',()=>{
 const {Shell,cabinetNav}=shell();
 const html=renderToStaticMarkup(React.createElement(Shell,{title:'Кабинет',description:'Описание',eyebrow:'Кабинет',nav:cabinetNav,activeHref:'/cabinet/vakansii'},'content'));
 assert.equal((html.match(/data-profile/g)||[]).length,1);
 assert.equal((html.match(/aria-current="page"/g)||[]).length,1);
 const active=html.match(/<a\b[^>]*aria-current="page"[^>]*>/)?.[0];
 assert.match(active,/href="\/cabinet\/vakansii"/);
 for(const item of cabinetNav)assert.ok(html.includes('href="'+item.href+'"'));
 assert.match(html,/pb-16 sm:pb-20/);assert.match(html,/data-actions/);assert.match(html,/>content</);
});

test('admin navigation with the same shape never mounts a cabinet profile',()=>{
 const {Shell,cabinetNav}=shell(),nav=[{...cabinetNav[0],href:'/admin',label:'Обзор'}];
 const html=renderToStaticMarkup(React.createElement(Shell,{title:'Админка',description:'Описание',eyebrow:'Администрирование',nav,activeHref:'/admin'},'content'));
 assert.equal(html.includes('data-profile'),false);assert.match(html,/pb-6 sm:pb-10/);
 assert.equal((html.match(/aria-current="page"/g)||[]).length,1);
});

test('a shell without navigation retains its content and nullable create action',()=>{
 const {Shell}=shell();
 const html=renderToStaticMarkup(React.createElement(Shell,{title:'Оплата',description:'Описание',eyebrow:'Оплата',createHref:null},'payment content'));
 assert.equal(html.includes('data-profile'),false);assert.equal(html.includes('aria-label="Разделы"'),false);
 assert.equal(html.includes('href="/razmestit"'),false);assert.match(html,/payment content/);
});

for(const enabled of [false,true])test(`shared legacy rows preserve fallback=${enabled}`,()=>{
 let calls=0;
 const {paymentRows,responseRows}=load('src/components/cabinet/dashboard-rows.ts',{
  '@/lib/runtime-mode':{shouldShowFallbackContent:()=>enabled},
  '@/lib/mock-store':{
   listMockPayments:()=>{calls++;return [{id:'payment',targetTitle:'Предложение',amount:199,provider:'mock',status:'succeeded'}];},
   listApplications:()=>{calls++;return [{id:'application',paymentId:'payment',specialistName:'Специалист',status:'sent',vacancyTitle:'Вакансия'}];},
  },
 });
 const payments=paymentRows(),responses=responseRows();
 assert.equal(payments.length,enabled?1:0);assert.equal(responses.length,enabled?1:0);assert.equal(calls,enabled?2:0);
 if(enabled){assert.equal(payments[0].method,'Оплата');assert.equal(payments[0].href,'/oplata/payment');assert.equal(responses[0].paymentHref,'/oplata/payment');assert.equal(responses[0].vacancyTitle,'Вакансия');}
});
