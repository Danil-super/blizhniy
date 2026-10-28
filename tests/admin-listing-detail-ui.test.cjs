const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const test = require('node:test');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const ts = require('typescript');
const root = resolve(__dirname, '..');
const id = '10000000-0000-4000-8000-000000000001';
const item = {id, revision:'3', title:'Комод', status:'published', paid:true, blocked:false, blockReason:null, blockedAt:null,
  card:{kind:'prodam', price:'3500.00', city:'Сочи', district:'Центральный', coverPhotoId:null}};
function load(file, state) {
  const exports = {}, filename = resolve(root, file); let hook = 0;
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  new Function('require','exports',code)(name => {
    if(name === 'react') return {...React, useState:initial => {const [value,set] = React.useState(initial);return [hook++ === 0 && state ? state : value,set];}};
    if(name === 'next/link') return {__esModule:true,default:({children,...props})=>{delete props.prefetch;return React.createElement('a',props,children);}};
    if(name.endsWith('/PrivateDraftEditor'))return {draftButton:'min-h-11'};
    if(name.endsWith('/useDraftLeaveGuard'))return {useDraftLeaveGuard(){}};
    if(name.endsWith('/local-account'))return {notifyAccountSessionChange(){}};
    if(name.endsWith('/AccountAuthProvider'))return {usePrimaryAccountAuth:()=>({state:'admin',userId:id})};
    if(name.endsWith('/client-listing-management'))return {listingManagement:{},ListingManagementClientError:Error};
    if(name.endsWith('/client-admin-overview'))return {adminOverview:{},AdminOverviewClientError:Error};
    if(name.endsWith('/ListingBadges'))return {ListingKindBadge:({kind})=>React.createElement('span',null,kind),StatusBadge:({status})=>React.createElement('span',null,status)};
    if(name === './ListingManagementPhoto')return {ListingManagementPhoto:({alt})=>React.createElement('div',{'data-photo':true,'data-alt':alt})};
    if(name === 'next/navigation')return {notFound(){throw Error('NOT_FOUND');}};
    if(name.endsWith('/listing-workflow-config'))return {readPostmoderationEnabled:()=>true};
    if(name.endsWith('/listing-draft-contract'))return {parseListingDraftId:value=>{if(!/^[a-f0-9-]{36}$/.test(value))throw Error('Invalid id');return value;}};
    if(name.endsWith('/AdminShell'))return load('src/components/admin/AdminShell.tsx');
    if(name.endsWith('/AdminAuthGate'))return {AdminAuthGate:({children})=>children};
    if(name.endsWith('/SiteHeader'))return {SiteHeader:()=>null};
    if(name.endsWith('/PostgresListingManagement'))return {PostgresListingManagement:({listingId})=>React.createElement('div',{'data-detail-id':listingId})};
    if(name === './ListingModerationFields')return {ListingModerationFields:({form})=>React.createElement('dl',null,React.createElement('dt',null,'Телефон'),React.createElement('dd',null,form.contactPhone))};
    if(name.startsWith('./'))return load('src/components/admin/'+name.slice(2)+'.tsx');
    return require(name);
  },exports);
  return exports;
}
test('admin card Details is a real separate-page link, never an inline action',()=>{
  const {ListingManagementCard}=load('src/components/admin/ListingManagementCard.tsx');
  const html=renderToStaticMarkup(React.createElement(ListingManagementCard,{actor:id,item}));
  assert.match(html,new RegExp('href="/admin/obyavleniya/'+id+'"'));
  assert.match(html,/>Подробнее/);
  assert.doesNotMatch(html,/<button|aria-pressed/);
});
test('admin list contains every card inside one labelled bounded keyboard-scroll area',()=>{
  const {ListingManagementList}=load('src/components/admin/ListingManagementWorkspace.tsx');
  assert.equal(typeof ListingManagementList,'function');
  const items=Array.from({length:20},(_,index)=>({...item,id:id.slice(0,-2)+String(index).padStart(2,'0')}));
  const html=renderToStaticMarkup(React.createElement(ListingManagementList,{actor:id,page:{items,nextCursor:null}}));
  assert.match(html,/role="region"[^>]*aria-label="Список объявлений"[^>]*tabIndex="0"/i);
  assert.match(html,/max-h-\[[^\]]+\].*overflow-y-auto/);
  assert.equal((html.match(/<article/g)||[]).length,20);
  assert.equal((html.match(/href="\/admin\/obyavleniya\//g)||[]).length,20);
  assert.doesNotMatch(html,/Управление объявлением|textarea/);
});
test('separate details render saved text, private contacts, gallery and reason-required block controls',()=>{
  const detail={listing:item,snapshot:{id,revision:'3',form:{title:'Комод',description:'Полное сохранённое описание',contactPhone:'+79990000000'},photos:[{id:'photo-1'}]}};
  const {ListingManagementDetailWorkspace}=load('src/components/admin/ListingManagementDetailWorkspace.tsx',detail);
  const html=renderToStaticMarkup(React.createElement(ListingManagementDetailWorkspace,{actor:id,listingId:id,visible:true}));
  for(const text of ['Комод','Полное сохранённое описание','+79990000000','Причина блокировки','Заблокировать объявление','Вернуться к объявлениям','Фотография 1 из 1'])assert.ok(html.includes(text),text);
  assert.match(html,/maxLength="1000"/i);
  assert.doesNotMatch(html,/Все объявления|Следующие объявления/);
  const hidden=renderToStaticMarkup(React.createElement(ListingManagementDetailWorkspace,{actor:id,listingId:id,visible:false}));
  assert.equal(hidden,'');
});
test('primary overview keeps metrics and explanation but no duplicate section navigation',()=>{
  const {PrimaryAdminOverview}=load('src/components/admin/PrimaryAdminOverview.tsx');
  const html=renderToStaticMarkup(React.createElement(PrimaryAdminOverview,{postmoderation:true}));
  assert.match(html,/Рабочий обзор админки/);
  assert.match(html,/Обновить обзор/);
  assert.match(html,/Управление публикациями/);
  assert.doesNotMatch(html,/href="\/admin\//);
});
test('detail route preserves all admin tabs with listings active and rejects malformed route IDs',async()=>{
  const {default:Page}=load('src/app/admin/obyavleniya/[id]/page.tsx');
  const html=renderToStaticMarkup(await Page({params:Promise.resolve({id})}));
  assert.match(html,new RegExp('data-detail-id="'+id+'"'));
  assert.equal((html.match(/aria-current="page"/g)||[]).length,1);
  assert.equal((html.match(/href="\/admin(?:\/[^" ]+)?"/g)||[]).length,11);
  assert.match(html,/aria-current="page"[^>]*href="\/admin\/obyavleniya"/);
  await assert.rejects(()=>Page({params:Promise.resolve({id:'invalid'})}),/NOT_FOUND/);
});
test('a blocked detail displays the full saved reason without offering a duplicate block write',()=>{
  const reason='Нарушение правил: неверная категория.';
  const detail={listing:{...item,blocked:true,blockReason:reason},snapshot:{form:{title:'Комод',description:'Описание',contactPhone:null},photos:[]}};
  const {ListingManagementDetailWorkspace}=load('src/components/admin/ListingManagementDetailWorkspace.tsx',detail);
  const html=renderToStaticMarkup(React.createElement(ListingManagementDetailWorkspace,{actor:id,listingId:id,visible:true}));
  assert.ok(html.includes(reason));
  assert.match(html,/Изменение объявления не снимает блокировку/);
  assert.doesNotMatch(html,/<textarea|Заблокировать объявление/);
});
