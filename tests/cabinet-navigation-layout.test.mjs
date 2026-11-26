import assert from 'node:assert/strict';
import test from 'node:test';
import{readFileSync}from'node:fs';import{createRequire}from'node:module';import vm from'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
function load(file,deps){
 const out={};vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:out,require:name=>Object.hasOwn(deps,name)?deps[name]:require(name)});return out;
}
const action=({mode='header'})=>React.createElement(mode==='logout'?'button':'a',{'data-cabinet-action':mode},mode);
const deps={'@/components/SiteHeader':{SiteHeader:()=>null},'@/components/cabinet/CabinetProfileBar':{CabinetProfileBar:()=>null},'@/components/cabinet/CabinetShellActions':{CabinetShellActions:action}};
test('cabinet navigation starts with create, ends with logout and keeps only one current section',()=>{
 const{Shell,cabinetNav}=load('src/components/DashboardShell.tsx',deps);
 const html=renderToStaticMarkup(React.createElement(Shell,{title:'Кабинет',description:'Описание',eyebrow:'Кабинет',nav:cabinetNav,activeHref:'/cabinet/obyavleniya'},'content'));
 const nav=html.match(/<nav\b[^>]*aria-label="Разделы"[^>]*>([\s\S]*?)<\/nav>/)?.[1];assert.ok(nav);
 assert.doesNotMatch(html,/Обзор|data-cabinet-action="header"/);
 assert.match(nav,/^<a data-cabinet-action="create"/);assert.match(nav,/<button data-cabinet-action="logout">logout<\/button>$/);
 assert.equal(cabinetNav[0].label,'Мои объявления');assert.equal(cabinetNav[0].href,'/cabinet/obyavleniya');
 assert.equal(cabinetNav.at(-1).label,'Ярмарка');assert.equal((html.match(/aria-current="page"/g)??[]).length,1);
 assert.equal((html.match(/data-cabinet-action="create"/g)??[]).length,1);assert.equal((html.match(/data-cabinet-action="logout"/g)??[]).length,1);
});
test('cabinet shell renders the payment notice above the workspace',()=>{
 const {Shell,cabinetNav}=load('src/components/DashboardShell.tsx',deps);
 const notice=React.createElement('h2',{tabIndex:-1},'Размещение выполнено');
 const html=renderToStaticMarkup(React.createElement(Shell,{title:'Кабинет',description:'Описание',eyebrow:'Кабинет',nav:cabinetNav,notice},'Содержимое раздела'));
 assert.match(html,/<\/nav>[\s\S]*<h2 tabindex="-1">Размещение выполнено<\/h2>Содержимое раздела<\/div>/i);
});
test('cabinet entry displays the same listings section without dropping the settings URL',()=>{
 const widget=()=>null;
 const out=load('src/components/cabinet/CabinetPages.tsx',{'@/components/DashboardShell':{Shell:widget,cabinetNav:[]},'@/components/auth/CabinetAuthGate':{},'@/components/listings/CabinetDraftWorkspace':{CabinetDraftWorkspace:widget},'./CabinetPublicationWorkspace':{},'@/components/bookings/BookingsPanel':{},'@/components/payments/PlacementReturnNotice':{PlacementReturnNotice:()=>null},'./CabinetEntryClients':{},'./dashboard-rows':{}});
 assert.equal(out.CabinetPage().type,out.CabinetListingsPage);
 const list=out.CabinetListingsPage();assert.equal(list.props.activeHref,'/cabinet/obyavleniya');
 assert.ok(list.props.children.props.footer,'The account-deletion link must remain reachable after removing overview');
 const footer=renderToStaticMarkup(list.props.children.props.footer);
 assert.match(footer,/<a[^>]+href="\/cabinet\/moi-dannye"[^>]*>Мои персональные данные<\/a>/);
 assert.match(footer,/<a[^>]+href="\/cabinet\/udalit-akkaunt"[^>]*>Запросить удаление аккаунта<\/a>/);
});
