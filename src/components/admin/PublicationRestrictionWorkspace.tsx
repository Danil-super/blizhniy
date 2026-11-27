"use client";

import {useState,type FormEvent} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {draftButton} from '@/components/listings/PrivateDraftEditor';
import {useDraftLeaveGuard} from '@/components/listings/useDraftLeaveGuard';
import {notifyAccountSessionChange} from '@/lib/local-account';
import {
 PublicationRestrictionError,parsePublicationRestrictionError,parsePublicationRestrictionPreview,
 parsePublicationRestrictionReceipt,parsePublicationRestrictionRequest,type PublicationRestrictionCommand,
 type PublicationRestrictionErrorCode,
} from '@/lib/admin-publication-restriction-contract';

const kinds={
 vacancy:'Вакансия',workRequest:'Заказ',specialist:'Анкета специалиста',fair:'Карточка ярмарки',marquee:'Бегущая строка',
};
const errors:Record<PublicationRestrictionErrorCode,string>={
 ADMIN_REQUIRED:'Нужны действующие права модератора на эту карточку.',
 INVALID_INPUT:'Проверьте тип и формат идентификатора.',
 PUBLICATION_NOT_FOUND:'Карточка этого типа не найдена.',
 RESTRICTION_CONFLICT:'Ревизия, состояние карточки или номер обращения изменились. Сверьте обращение и найдите карточку снова.',
 ACCESS_BUSY:'Публикация сейчас обрабатывается. Повторите проверку.',
 ACCESS_UNAVAILABLE:'Сервис временно недоступен. Повторите проверку позже.',
};
const inputStyle='mt-1 block min-h-11 w-full rounded-lg border border-slate-500 bg-white px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700';
const buttonStyle=draftButton+' bg-blue-700 text-white';
type Preview=ReturnType<typeof parsePublicationRestrictionPreview>;
type Receipt=ReturnType<typeof parsePublicationRestrictionReceipt>;

async function post(body:Record<string,unknown>):Promise<unknown>{
 const response=await fetch('/api/admin/publication-restriction',{
  method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(25000),
  headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify(body),
 });
 if(response.status===401)throw new PublicationRestrictionError('ADMIN_REQUIRED');
 const result:unknown=await response.json();
 if(response.status!==200)throw parsePublicationRestrictionError(response.status,result);
 return result;
}

function RestrictionForm({actor,visible}:{actor:string;visible:boolean}){
 const [kind,setKind]=useState('vacancy'),[publicationId,setPublicationId]=useState(''),[caseId,setCaseId]=useState('');
 const [preview,setPreview]=useState<Preview|null>(null),[receipt,setReceipt]=useState<Receipt|null>(null);
 const [pending,setPending]=useState<PublicationRestrictionCommand|null>(null);
 const [busy,setBusy]=useState(false),[problem,setProblem]=useState('');
 useDraftLeaveGuard(visible&&pending!==null);

 function clearPreview(){
  setPreview(null);
  setReceipt(null);
  setCaseId('');
  setProblem('');
 }

 async function inspect(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(busy||pending||!visible)return;
  const input={action:'inspect',expectedAdminId:actor,kind,publicationId:publicationId.trim()};
  clearPreview();
  setBusy(true);
  try{
   const request=parsePublicationRestrictionRequest(input);
   if(request.action==='inspect')setPreview(parsePublicationRestrictionPreview(request.target,await post(input)));
  }catch(error){
   setProblem(errors[refreshOnDenial(error)]);
  }finally{
   setBusy(false);
  }
 }

 async function restrict(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(busy||!preview||preview.restricted||receipt||!visible)return;
  let command=pending;
  setProblem('');
  if(!command){
   try{
    const request=parsePublicationRestrictionRequest({action:'restrict',expectedAdminId:actor,kind:preview.kind,
     publicationId:preview.publicationId,expectedRevision:preview.revision,caseId:caseId.trim()});
    if(request.action==='restrict')command=request.command;
   }catch{
    setProblem('Укажите номер обращения в формате UUID.');
   }
   if(!command)return;
  }
  setPending(command);
  setBusy(true);
  try{
   setReceipt(parsePublicationRestrictionReceipt(command,await post({action:'restrict',...command})));
   setPending(null);
  }catch(error){
   const code=refreshOnDenial(error);
   if(code==='ACCESS_UNAVAILABLE'||code==='ACCESS_BUSY'||(pending&&code==='ADMIN_REQUIRED')){
    setProblem('Результат пока не подтверждён. Повторите проверку с сохранёнными номером обращения и ревизией.');
   }else{
    setPending(null);
    setPreview(null);
    setProblem(errors[code]);
   }
  }finally{
   setBusy(false);
  }
 }

 if(!visible)return null;
 return <section aria-label="Решение по публикации" className="max-w-2xl rounded-xl border border-slate-200 bg-white p-4 text-slate-900 sm:p-6">
  <form aria-label="Поиск публикации" onSubmit={inspect}>
   <fieldset disabled={busy||pending!==null} className="grid min-w-0 gap-4">
    <div>
     <label htmlFor="restriction-kind" className="font-semibold">Тип публикации</label>
     <select id="restriction-kind" name="kind" value={kind} className={inputStyle}
      onChange={event=>{setKind(event.currentTarget.value);clearPreview();}}>
      {Object.entries(kinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}
     </select>
    </div>
    <div>
     <label htmlFor="restriction-id" className="font-semibold">ID публикации</label>
     <input id="restriction-id" name="publicationId" required maxLength={36} spellCheck={false} value={publicationId}
      onChange={event=>{setPublicationId(event.currentTarget.value);clearPreview();}} className={inputStyle}/>
    </div>
    <button type="submit" className={buttonStyle}>Найти публикацию</button>
   </fieldset>
  </form>
  {problem&&<p role="alert" className="mt-4 text-red-800">{problem}</p>}
  {busy&&<p role="status" className="mt-4 text-slate-700">Проверяем запрос…</p>}
  {preview&&<div className="mt-5 border-t border-slate-200 pt-4">
   <h2 className="text-lg font-bold [overflow-wrap:anywhere]">{preview.title||'Публикация без названия'}</h2>
   <dl className="my-3 grid gap-1 text-sm text-slate-700">
    <div><dt className="inline font-semibold">Тип </dt><dd className="inline">{kinds[preview.kind]}</dd></div>
    <div><dt className="inline font-semibold">ID </dt><dd className="inline break-all">{preview.publicationId}</dd></div>
    <div><dt className="inline font-semibold">Ревизия </dt><dd className="inline">{preview.revision}</dd></div>
   </dl>
   {receipt?<div role="status" className="rounded-lg bg-green-50 p-3 text-green-900">
    <p className="font-semibold">Ограничение сохранено</p>
    <p>Номер обращения <span className="break-all">{receipt.caseId}</span></p>
    <p>Время решения <time dateTime={receipt.restrictedAt}>{receipt.restrictedAt}</time></p>
   </div>:preview.restricted?<p role="status">Публичный показ уже ограничен.</p>:<form aria-label="Ограничение публикации" onSubmit={restrict} className="grid gap-4">
    <div>
     <label htmlFor="restriction-case" className="font-semibold">Номер обращения (UUID)</label>
     <input id="restriction-case" name="caseId" required maxLength={36} value={pending?.caseId??caseId}
      onChange={event=>setCaseId(event.currentTarget.value)} readOnly={pending!==null||busy} spellCheck={false} className={inputStyle}/>
    </div>
    <button type="submit" disabled={busy} className={buttonStyle}>
     {pending?'Проверить результат':'Ограничить публикацию'}
    </button>
   </form>}
  </div>}
 </section>;
}

function refreshOnDenial(error:unknown){
 const code=error instanceof PublicationRestrictionError?error.code:'ACCESS_UNAVAILABLE';
 if(code==='ADMIN_REQUIRED'){
  notifyAccountSessionChange(true);
  notifyAccountSessionChange(false);
 }
 return code;
}

export function PublicationRestrictionWorkspace(){
 const auth=usePrimaryAccountAuth(),actor=auth?.state==='admin'?auth.userId:null;
 const [scopeActor,setScopeActor]=useState(actor);
 if(actor&&actor!==scopeActor)setScopeActor(actor);
 if((auth?.state==='signed-out'||auth?.state==='signed-in')&&scopeActor)setScopeActor(null);
 const visible=actor!==null&&actor===scopeActor;
 return <>
  {!visible&&<p role="status">{auth?.state==='loading'?'Проверяем права администратора…':'Доступ администратора не подтверждён.'}</p>}
  {scopeActor&&<RestrictionForm key={scopeActor} actor={scopeActor} visible={visible}/>}
 </>;
}
