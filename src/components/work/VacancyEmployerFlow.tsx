"use client";
import {useRef,useState,type ReactNode} from 'react';
import {Field} from '@/components/FormPanel';
import type {VacancyEmployerDefaults} from '@/components/VacancyEmployerFields';
import {checkVacancyEmployer} from '@/lib/vacancy-checkout-validation';
import type {VacancyEmployerType} from '@/lib/vacancy-requisites';

const types=[{id:'organization',label:'Организация',hint:'Юридическое лицо: название, ИНН и контакты.'},
 {id:'ip',label:'ИП',hint:'Индивидуальный предприниматель: ФИО, ИНН и контакты.'},
 {id:'person',label:'Частное лицо',hint:'Частный работодатель: имя и телефон.'}] as const;
/** Keep both steps mounted: Back/type changes must not erase entered fields or photos. */
export function VacancyEmployerFlow({defaults,children,disabled=false,actions}:{defaults?:VacancyEmployerDefaults;children:ReactNode;disabled?:boolean;actions?:ReactNode}){
 const initial=types.find(item=>item.id===defaults?.employerType)?.id??null;
 const [type,setType]=useState<VacancyEmployerType|null>(initial),[step,setStep]=useState(1),[error,setError]=useState<string|null>(null);
 const refs=useRef<Partial<Record<VacancyEmployerType,HTMLFieldSetElement|null>>>({});
 function continueForm(){
  if(!type)return;const fields=refs.current[type];if(!fields)return;
  const inputs=[...fields.querySelectorAll<HTMLInputElement>('input')];
  if(inputs.some(input=>!input.reportValidity()))return;
  const value=(name:string)=>inputs.find(input=>input.name===name)?.value.trim()??'';
  const secondary=value('emailOrMessenger'),issues=checkVacancyEmployer({employerType:type,organization:value('organization'),inn:value('inn'),ogrn:value('ogrn'),ogrnip:value('ogrnip'),
   contactPerson:value('contactPerson'),contactPhone:value('phone'),email:secondary&&!secondary.startsWith('@')&&secondary.includes('@')?secondary:null,
   messengerUrl:value('messengerUrl')||(secondary&&!(!secondary.startsWith('@')&&secondary.includes('@'))?secondary:null),website:value('website')||null});
  if(issues.length){setError(issues.join(' '));return;}setError(null);setStep(2);
 }
 return <>
  <section aria-label="Данные работодателя" className={step===1?'grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4':'hidden'}>
   <div><p className="text-xs font-bold uppercase text-blue-700">Шаг 1 из 2</p><h2 className="mt-1 text-xl font-bold">Кто размещает вакансию?</h2></div>
   <div className="grid gap-2 md:grid-cols-3">{types.map(item=><button key={item.id} type="button" disabled={disabled} aria-pressed={type===item.id}
    onClick={()=>{setType(item.id);setError(null);}} className={`rounded-xl border p-3 text-left ${type===item.id?'border-blue-500 bg-blue-50 ring-2 ring-blue-100':'border-slate-200 bg-white'}`}>
    <span className="block font-bold">{item.label}</span><span className="mt-1 block text-xs text-slate-600">{item.hint}</span></button>)}</div>
   {!type&&<p className="text-sm text-slate-600">Выберите тип работодателя — ниже появятся необходимые поля.</p>}
   {types.map(item=>{const d=initial===item.id?defaults:undefined;return <fieldset key={item.id} ref={node=>{refs.current[item.id]=node;}}
    disabled={disabled||type!==item.id} className={type===item.id?'grid min-w-0 gap-3 sm:grid-cols-2':'hidden'}
    onInvalidCapture={()=>setStep(1)}>
    <legend className="mb-3 font-semibold">{item.label}: реквизиты и контакты</legend>
    <input type="hidden" name="employerType" value={item.id}/>
    <Field name="organization" label={item.id==='person'?'Имя':item.id==='ip'?'ФИО ИП':'Название организации'} defaultValue={d?.organization} minLength={2} maxLength={item.id==='person'?60:120} required/>
    {item.id!=='person'&&<>
     <Field name="inn" label="ИНН" defaultValue={d?.inn} inputMode="numeric" pattern={item.id==='ip'?'[0-9]{12}':'[0-9]{10}'} maxLength={item.id==='ip'?12:10} title={item.id==='ip'?'12 цифр ИНН':'10 цифр ИНН'} required/>
     <Field name={item.id==='ip'?'ogrnip':'ogrn'} label={item.id==='ip'?'ОГРНИП (если есть)':'ОГРН (если есть)'} defaultValue={item.id==='ip'?d?.ogrnip:d?.ogrn}
      inputMode="numeric" pattern={item.id==='ip'?'[0-9]{15}':'[0-9]{13}'} maxLength={item.id==='ip'?15:13}/>
     <Field name="contactPerson" label="Контактное лицо" defaultValue={d?.contactPerson} minLength={2} maxLength={80} required/>
    </>}
    <Field name="phone" label="Телефон" defaultValue={d?.phone} required/>
    {item.id==='person'?<Field name="messengerUrl" label="WhatsApp / Telegram (необязательно)" defaultValue={d?.messengerUrl} placeholder="@username или https://…" maxLength={500}/>
     :<Field name="emailOrMessenger" label="Email / мессенджер" defaultValue={d?.email||d?.messengerUrl} required maxLength={254}/>}
    {item.id!=='person'&&<Field name="website" label="Сайт" defaultValue={d?.website} type="url" placeholder="https://…" maxLength={500}/>}
   </fieldset>;})}
   {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
   <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-600">Контакты не показываются в публичной карточке.</p>
    <button type="button" disabled={disabled||!type} onClick={continueForm} className="min-h-11 rounded-xl bg-brand-blue px-5 font-bold text-white disabled:opacity-50">Продолжить к вакансии</button></div>
  </section>
  <div className={step===2?'grid min-w-0 gap-4':'hidden'}>
   <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50 p-3">
    <div><p className="text-xs font-bold uppercase text-blue-700">Шаг 2 из 2</p><p className="font-semibold">{types.find(item=>item.id===type)?.label} · Вакансия</p></div>
    <button type="button" disabled={disabled} onClick={()=>setStep(1)} className="min-h-11 rounded-lg border border-blue-200 bg-white px-4 font-semibold text-blue-700">Изменить работодателя</button>
   </div>
   <fieldset disabled={disabled||step!==2} className="grid min-w-0 gap-4"><legend className="sr-only">Данные вакансии</legend>{children}</fieldset>
   {actions}
  </div>
 </>;
}
