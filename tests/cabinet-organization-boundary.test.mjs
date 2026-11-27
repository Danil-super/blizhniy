import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import * as formValidation from '../src/lib/cabinet-form-validation.ts';
const require=createRequire(import.meta.url),ts=require('typescript');
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const jsx=(type,props,key)=>({type,props,key});
const nodes=root=>!root||typeof root!=='object'?[]:[root,...[root.props?.children].flat(Infinity).flatMap(nodes)];
const text=root=>typeof root==='string'?root:root&&typeof root==='object'?[root.props?.children].flat(Infinity).map(text).join(' '):'';
function harness(data){
 const state=[],effects=[];let index=0,effectIndex=0;const scheduled=[];
 const module={exports:{}};
 vm.runInNewContext(compile(readFileSync(new URL('../src/components/cabinet/CabinetOrganization.tsx',import.meta.url),'utf8')),{module,exports:module.exports,Error,
  require:name=>{
   if(name==='react')return {useId:()=>'organization-description',useState(initial){const slot=index++;if(!Object.hasOwn(state,slot))state[slot]=initial;return [state[slot],value=>state[slot]=typeof value==='function'?value(state[slot]):value];},useEffect(work,deps){const slot=effectIndex++,old=effects[slot];if(!old||deps.some((value,i)=>value!==old[i])){effects[slot]=deps;scheduled.push(work);}}};
   if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};
   if(name==='./CookieCabinetProfileProvider')return {CabinetProfileFailure:'failure',useCookieCabinetProfile:()=>data.cookie??null};
   if(name==='@/components/CabinetFormValidation')return {CabinetFormValidation:'validation'};
   if(name==='@/lib/cabinet-form-validation')return formValidation;
   throw Error('Unexpected organization dependency: '+name);
  }});
 return {state,render(){index=0;effectIndex=0;const tree=module.exports.CabinetOrganizationView({data});scheduled.splice(0).forEach(work=>work());return tree;},cookie:()=>module.exports.CookieCabinetOrganization()};
}
const profile={name:'Тест',email:'user@example.invalid',phone:'+79990000000',city:'Краснодар',organizationName:'',organizationInn:'',organizationOgrn:'',organizationAddress:'',organizationWebsite:'',organizationDescription:''};
const data=()=>({identity:{ownerKey:'a'},profile:{...profile},loading:false,saveProfile:async value=>value});
const submit=tree=>nodes(tree).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
const change=(h,name,value)=>{const input=nodes(h.render()).find(node=>node.props?.name===name);assert.ok(input,name);input.props.onChange({target:{value}});};

test('organization keeps existing identifier validation and saves all profile fields through its supplied owner-bound callback',async()=>{
 const input=data(),calls=[];input.saveProfile=async value=>{calls.push(value);return value;};const h=harness(input);
 await submit(h.render());assert.equal(calls.length,0);assert.ok(text(h.render()).includes('Укажите название'));
 change(h,'organizationName','  ИП Тест  ');change(h,'organizationInn','123');await submit(h.render());assert.equal(calls.length,0);assert.ok(text(h.render()).includes('10 или 12'));
 change(h,'organizationInn','100000000075');await submit(h.render());assert.equal(calls.length,0);
 const invalidInn = nodes(h.render()).find(node=>node.props?.name==='organizationInn');
 assert.equal(invalidInn.props['aria-invalid'],true);
 assert.ok(text(nodes(h.render()).find(node=>node.props?.id===invalidInn.props['aria-describedby'])).includes('контрольные цифры ИНН'));
 change(h,'organizationInn','100000000074');change(h,'organizationOgrn','123');await submit(h.render());assert.equal(calls.length,0);assert.ok(text(h.render()).includes('13 или 15'));
 change(h,'organizationOgrn','100000000000001');await submit(h.render());assert.equal(calls.length,0);assert.ok(text(h.render()).includes('контрольную цифру ОГРН'));
 change(h,'organizationOgrn','100000000000000');change(h,'organizationDescription','Описание\nВторая строка');await submit(h.render());
 assert.equal(calls.length,1);assert.equal(calls[0].organizationName,'ИП Тест');assert.equal(calls[0].organizationInn,'100000000074');assert.equal(calls[0].organizationOgrn,'100000000000000');assert.equal(calls[0].organizationDescription,'Описание\nВторая строка');assert.equal(calls[0].email,profile.email);assert.equal(calls[0].phone,profile.phone);
 assert.ok(text(h.render()).includes('Профиль организации сохранен.'));
 const fields=nodes(h.render());
 const description=fields.find(node=>node.type==='textarea'&&node.props.name==='organizationDescription');
 assert.equal(fields.find(node=>node.type==='label'&&node.props.htmlFor===description.props.id)?.props.children,'Краткое описание');
});

test('organization save failures retain typed fields and loaded-profile errors disable submission',async()=>{
 const input=data();input.saveProfile=async()=>{throw Error('Профиль изменён в другой вкладке.');};const h=harness(input);
 change(h,'organizationName','Тестовая компания');await submit(h.render());assert.equal(h.state[0].organizationName,'Тестовая компания');assert.ok(text(h.render()).includes('Профиль изменён'));
 input.profileError='Не удалось обновить профиль';await submit(h.render());assert.ok(nodes(h.render()).find(node=>node.props?.type==='submit').props.disabled);
 input.profile=null;assert.equal(h.render().type,'failure');
});

test('primary organization never falls back to legacy profile and keys forms by current owner',()=>{
 const missing=harness(data()).cookie();assert.equal(missing.props.data.profile,null);assert.ok(missing.props.data.profileError);assert.equal(missing.props.data.saveProfile,undefined);
 const input=data();input.cookie={ownerId:'a',profile:input.profile,loading:false,saveProfile:input.saveProfile};const h=harness(input),a=h.cookie();
 assert.equal(a.key,'a');assert.equal(a.props.data.saveProfile,input.saveProfile);input.cookie={...input.cookie,ownerId:'b'};assert.equal(h.cookie().key,'b');
});
