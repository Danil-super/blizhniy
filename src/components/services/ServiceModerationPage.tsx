"use client";
import {useState} from 'react';import Link from 'next/link';import {SiteHeader} from '@/components/SiteHeader';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';import {notifyAccountSessionChange} from '@/lib/local-account';
import type {ServicePublicationKind} from '@/lib/service-publication-contract';import {draftButton} from '@/components/listings/PrivateDraftEditor';
import {ServiceModerationWorkspace} from './ServiceModerationWorkspace';import {serviceFormLabels} from './ServicePublicationForm';
export function ServiceModerationPage({kind}:{kind:ServicePublicationKind}){
 const auth=usePrimaryAccountAuth(),actor=auth?.state==='admin'?auth.userId:null,[scope,setScope]=useState(actor);
 if(actor&&actor!==scope)setScope(actor);if((auth?.state==='signed-out'||auth?.state==='signed-in')&&scope)setScope(null);const visible=!!actor&&actor===scope;
 return <><SiteHeader/><main className="page-container dashboard-shell pb-8 pt-6">
  <nav aria-label="Навигация модератора" className="flex flex-wrap gap-4"><Link href="/admin" className="min-h-11 py-2 font-semibold underline">Разделы админки</Link><Link href="/cabinet" className="min-h-11 py-2 font-semibold underline">Личный кабинет</Link></nav>
  <h1 className="mt-4 text-2xl font-bold">Модерация материалов</h1><p className="mt-2 text-slate-700">{serviceFormLabels[kind]}</p>
  {!visible&&<div className="mt-4" role="status"><p>{auth?.state==='loading'?'Проверяем права. Данные модерации временно скрыты.':'Доступ администратора не подтверждён.'}</p>
   <Link href="/auth" className={`${draftButton} mt-3 inline-flex`}>Войти</Link><button type="button" className={`${draftButton} ml-3 mt-3`} onClick={()=>notifyAccountSessionChange(false)}>Проверить доступ</button></div>}
  {scope&&<ServiceModerationWorkspace key={`${scope}:${kind}`} actor={scope} kind={kind} visible={visible}/>}
 </main></>;
}
