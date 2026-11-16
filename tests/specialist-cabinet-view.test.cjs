const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {loadLocalPrimaryModule:load}=require('../scripts/local-primary-modules.cjs');
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const form=load('service-publication-contract').parseServicePublicationForm('specialist',{title:'Прежнее имя',description:'Ремонтирую сантехнику, работаю аккуратно и соблюдаю сроки.',cityName:'Краснодар',professionName:'Сантехник',price:'1500',contactPhone:'+79990000000',placementRightConfirmed:true});
const snapshot={id,kind:'specialist',form,photos:[],revision:'4',status:'draft',paid:false,createdAt:'2026-10-25T12:00:00.123456Z',updatedAt:'2026-10-26T12:00:00.123456Z',publishedAt:null,expiresAt:null};
function moduleAt(file,deps){const out={};const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/components/services/',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 new Function('require','exports',code)(name=>{if(Object.hasOwn(deps,name))return deps[name];if(name==='react/jsx-runtime')return require(name);throw Error('Unexpected dependency '+name);},out);return out;}
function fixture(api={},initialProfile){
 const values=[],effects=[],calls=[];let cursor=0,dirty=false,tree,visible=true,profile=initialProfile??{ownerId:owner,profile:{name:'Анна-Мария',avatarDataUrl:'data:image/png;base64,AA=='},loading:false};
 const react={useState(initial){const n=cursor++;if(!Object.hasOwn(values,n))values[n]=typeof initial==='function'?initial():initial;return[values[n],value=>{const next=typeof value==='function'?value(values[n]):value;if(!Object.is(next,values[n])){values[n]=next;dirty=true;}}];},useRef(initial){const n=cursor++;return values[n]??={current:initial};},useEffect(work,deps){const n=cursor++,prior=values[n];if(!prior||deps.some((value,i)=>!Object.is(value,prior.deps[i]))){values[n]={deps};effects.push(()=>{prior?.cleanup?.();values[n].cleanup=work();});}}};
 const Status=moduleAt('SpecialistApplicationStatus.tsx',{'next/link':{__esModule:true,default:link},'@/lib/specialist-application-profile':load('specialist-application-profile')}).SpecialistApplicationStatus;
 const {SpecialistProfilePanel}=moduleAt('SpecialistProfilePanel.tsx',{
  './ServiceModerationStatus':{ServiceModerationStatus:()=>null},'@/components/listings/ListingWorkflowProvider':{useSpecialistCheckout:()=>false},'@/components/PublicationPlacementPeriod':{PublicationPlacementPeriod:()=>null},
  react,'next/link':{__esModule:true,default:link},'@/lib/client-service-publications':{servicePublications:new Proxy({},{get(_target,key){return async(...args)=>{calls.push({key,args});return api[key]?api[key](...args):key==='list'?{items:[{id}],nextCursor:null}:snapshot;};}})},
  '@/lib/local-account':{notifyAccountSessionChange:()=>calls.push({key:'recheck'})},'@/lib/specialist-application-profile':load('specialist-application-profile'),'@/lib/messenger-url':load('messenger-url'),
  '@/components/cabinet/CookieCabinetProfileProvider':{useCookieCabinetProfile:()=>profile,CabinetProfileFailure:({message})=>React.createElement('p',{role:'alert'},message)},
  '@/components/StoredMedia':{StoredMediaImage:props=>React.createElement('img',props)},'@/components/listings/PrivateDraftEditor':{draftButton:'min-h-11'},
  './PrimaryServicePublicationEditor':{PrimaryServicePublicationEditor:props=>React.createElement('div',{'data-create-form':props.kind,'data-embedded':String(!!props.embedded)})},'./SpecialistApplicationStatus':{SpecialistApplicationStatus:Status},
 });
 function render(){cursor=0;dirty=false;tree=SpecialistProfilePanel({owner,visible});while(effects.length)effects.shift()();}
 async function settle(){for(let i=0;i<8;i++){await new Promise(resolve=>setImmediate(resolve));if(dirty)render();}}
 function click(label){function find(node){if(!node||typeof node!=='object')return null;if(node.type==='button'&&node.props.children===label)return node;for(const child of React.Children.toArray(node.props?.children)){const found=find(child);if(found)return found;}return null;}const button=find(tree);assert.ok(button,'Button '+label);button.props.onClick();render();}
 render();return{calls,settle,click,get html(){return renderToStaticMarkup(tree);},profile:value=>{profile=value;render();},visible:value=>{visible=value;render();},unmount(){for(const value of values)value?.cleanup?.();}};
}
function link({children,prefetch,...props}){void prefetch;return React.createElement('a',props,children);}
test('opening the tab loads the existing single questionnaire directly without list/details/create controls',async()=>{
 const h=fixture();assert.doesNotMatch(h.html,/Редактировать|data-create-form/);await h.settle();
 for(const value of ['Анна-Мария','Сантехник','Краснодар','О себе','Ремонтирую сантехнику','+79990000000','Анкета заполнена','Редактировать'])assert.ok(h.html.includes(value),value);
 assert.match(h.html,/1(?:\s| | )+500/);assert.doesNotMatch(h.html,/1500\.00|Прежнее имя|Мои материалы|Подробнее|Создать анкету|Следующая страница|data-create-form/);
 assert.match(h.html,new RegExp('href="/rabota/specialisty/anketa\\?draft='+id+'"'));assert.match(h.html,/Фото из профиля/);
 assert.match(h.html,/mx-auto w-full min-w-0 max-w-3xl/);
 assert.deepEqual(h.calls.map(call=>call.key),['list','read']);assert.equal(h.calls[1].args[2],id);
});
test('an empty account opens its one creation form, only after a confirmed empty response',async()=>{
 const h=fixture({list:async()=>({items:[],nextCursor:null})});assert.doesNotMatch(h.html,/data-create-form/);await h.settle();assert.match(h.html,/data-create-form="specialist" data-embedded="true"/);assert.equal(h.calls.length,1);
});
for(const operation of ['list','read'])test(`a ${operation} failure offers retry, never a second questionnaire form`,async()=>{
 let failed=true;const h=fixture({[operation]:async()=>{if(failed)throw Error('Не удалось загрузить анкету.');return operation==='list'?{items:[{id}],nextCursor:null}:snapshot;}});await h.settle();
 assert.match(h.html,/role="alert"/);assert.doesNotMatch(h.html,/data-create-form|Редактировать/);failed=false;h.click('Повторить загрузку');await h.settle();assert.match(h.html,/Анна-Мария/);
});
test('late read is ignored after unmount, and the fetch scope is aborted',async()=>{
 let resolve;const h=fixture({read:()=>new Promise(done=>{resolve=done;})});await h.settle();const signal=h.calls.find(call=>call.key==='read').args[3].signal;h.unmount();assert.equal(signal.aborted,true);resolve(snapshot);await h.settle();assert.doesNotMatch(h.html,/Анна-Мария|Редактировать/);
});
test('profile owner mismatch never displays a former name/avatar or substitutes historical questionnaire identity',async()=>{
 const h=fixture({}, {ownerId:id,profile:{name:'Чужой профиль',avatarDataUrl:'PRIVATE'},loading:false});await h.settle();assert.doesNotMatch(h.html,/Чужой профиль|PRIVATE|Прежнее имя|Редактировать/);assert.match(h.html,/Загружаем данные профиля/);
});
test('temporary auth recheck hides the entire owner workspace without losing its data',async()=>{
 const h=fixture();await h.settle();h.visible(false);assert.match(h.html,/hidden="" inert=""/);h.visible(true);assert.match(h.html,/Анна-Мария/);assert.equal(h.calls.length,2);
});
test('partial questionnaire still opens directly with missing-field guidance and an edit link',async()=>{
 const h=fixture({read:async()=>({...snapshot,form:{...form,professionName:null,price:null,description:''}})});await h.settle();assert.match(h.html,/Дополните анкету|Редактировать/);assert.doesNotMatch(h.html,/data-create-form|Анкета заполнена/);
});
test('unexpected multiple questionnaires or pagination fail closed instead of picking a hidden winner',async()=>{
 for(const page of [{items:[{id},{id:owner}],nextCursor:null},{items:[{id}],nextCursor:{id,updatedAt:snapshot.updatedAt}}]){const h=fixture({list:async()=>page});await h.settle();assert.match(h.html,/role="alert"/);assert.doesNotMatch(h.html,/Редактировать|data-create-form/);assert.equal(h.calls.some(call=>call.key==='read'),false);}
});
test('specialist tab routes to a single questionnaire while fair retains its independent list',()=>{
 const {ServicePublicationsPanel}=moduleAt('ServicePublicationsPanel.tsx',{
  react:{...React,useEffect(){},useRef:value=>({current:value})},'next/link':{__esModule:true,default:link},
  '@/components/auth/AccountAuthProvider':{usePrimaryAccountAuth:()=>({state:'signed-in',userId:owner})},
  '@/lib/local-account':{notifyAccountSessionChange(){}},'@/lib/client-service-publications':{servicePublications:{}},
  '@/lib/service-publication-navigation':load('service-publication-navigation'),'@/components/listings/PrivateDraftEditor':{draftButton:'min-h-11'},
  './ServicePublicationForm':{serviceFormLabels:{specialist:'Анкета специалиста',fair:'Заявка на ярмарку',marquee:'Рекламный текст'}},
  './ServiceModerationStatus':{ServiceModerationStatus:()=>null},'./PrimaryServicePublicationEditor':{PrimaryServicePublicationEditor:()=>null},
  './SpecialistProfilePanel':{SpecialistProfilePanel:()=>React.createElement('div',{'data-single-questionnaire':true})},
 });
 const specialist=renderToStaticMarkup(React.createElement(ServicePublicationsPanel,{kind:'specialist'}));assert.match(specialist,/data-single-questionnaire/);assert.doesNotMatch(specialist,/Создать анкету|Мои материалы/);
 const fair=renderToStaticMarkup(React.createElement(ServicePublicationsPanel,{kind:'fair'}));assert.match(fair,/Новая заявка на ярмарку/);assert.doesNotMatch(fair,/data-single-questionnaire/);
});
test('profile loading error remains recoverable without showing stale questionnaire identity',async()=>{
 const h=fixture({}, {ownerId:owner,profile:null,error:'Профиль недоступен',loading:false,reload(){}});await h.settle();assert.match(h.html,/Профиль недоступен/);assert.doesNotMatch(h.html,/Прежнее имя|Редактировать|data-create-form/);
});
