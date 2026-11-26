import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import * as notice from '../src/lib/cookie-notice.ts';
import {REGISTRATION_LEGAL_VERSIONS} from '../src/lib/registration-legal.ts';
import {legalDocuments} from '../src/lib/legal-documents.ts';

const require=createRequire(import.meta.url),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
function load(path,deps){
 const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
 }).outputText,{exports,require:name=>Object.hasOwn(deps,name)?deps[name]:require(name)});return exports;
}
const dependencies={
 'next/link':{default:({children,href,className})=>React.createElement('a',{href,className},children)},
 'next/navigation':{usePathname:()=> '/'},
 'lucide-react':{Cookie:()=>null,Mail:()=>null},
 '@/lib/cookie-notice':notice,
 '@/lib/analytics-consent':{
  getAnalyticsConsent(){assert.fail('SSR must not read browser consent');},
  saveAnalyticsConsent(){assert.fail('SSR must not save consent');},
  subscribeAnalyticsConsent(){assert.fail('SSR must not start browser observers');},
 },
};
const {CookieNotice,CookieNoticeButton}=load('src/components/CookieNotice.tsx',dependencies);
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));

test('without analytics the existing acknowledgement text, button and hidden SSR state are preserved',()=>{
 const html=render(CookieNotice,{initiallyAcknowledged:false});
 assert.match(html,/Используем cookie для входа и защиты аккаунта/);assert.match(html,/Понятно<\/button>/);
 assert.match(html,/href="\/legal\/privacy#cookies"/);assert.doesNotMatch(html,/Яндекс|Принять все|Только необходимые/);
 assert.equal(render(CookieNotice,{initiallyAcknowledged:true}),'');
 assert.match(render(CookieNoticeButton),/О файлах cookie<\/button>/);
});
test('optional analytics offers explicit accept and reject, never SSR tracking or an enabled pre-hydration action',()=>{
 const html=render(CookieNotice,{initiallyAcknowledged:false,analyticsAvailable:true});
 assert.match(html,/Используем cookie для работы сайта и, с вашего согласия, для анализа посещаемости\./);assert.match(html,/Принять все<\/button>/);assert.match(html,/Только необходимые<\/button>/);
 assert.equal((html.match(/<button[^>]*disabled=""/g)??[]).length,2);
 assert.doesNotMatch(html,/<script|<iframe|<img|rel="(?:preconnect|dns-prefetch)"|mc\.yandex|googletagmanager/);
 assert.doesNotMatch(html,/Понятно<\/button>|checked=/);
 assert.match(render(CookieNoticeButton,{analyticsAvailable:true}),/Настройки cookie<\/button>/);
});
test('footer exposes the consent settings only when analytics is available',()=>{
 const {SiteFooter}=load('src/components/SiteFooter.tsx',{
  ...dependencies,'@/components/BrandName':{BrandName:()=> 'БЛИЖНИЙ'},'./CookieNotice':{CookieNoticeButton},
 });
 assert.match(render(SiteFooter),/О файлах cookie<\/button>/);
 assert.match(render(SiteFooter,{analyticsAvailable:true}),/Настройки cookie<\/button>/);
});
test('the current privacy edition matches new registration acknowledgements and describes voluntary public-page analytics',()=>{
 assert.equal(REGISTRATION_LEGAL_VERSIONS.privacy,'2026-11-26');
 assert.equal(REGISTRATION_LEGAL_VERSIONS.agreement,'2026-06-18');
 assert.equal(legalDocuments.privacy.edition,'Редакция от 26 ноября 2026 г.');
 const text=legalDocuments.privacy.body.join('\n');
 assert.match(text,/Яндекс.Метрика загружается только после отдельного разрешения/);
 assert.match(text,/Отказ не ограничивает вход, кабинет, оплату/);
 assert.match(text,/Вебвизор, запись форм.+отключены/);
 assert.match(text,/Настройки cookie/);assert.match(text,/ранее переданные сведения не удаляются автоматически/);
});
