"use client";
import {useState} from 'react';
import Link from 'next/link';
import {SiteHeader} from '@/components/SiteHeader';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {notifyAccountSessionChange} from '@/lib/local-account';
import {draftButton} from '@/components/listings/PrivateDraftEditor';
import {WorkModerationWorkspace} from './WorkModerationWorkspace';
export function WorkModerationPage(){
 const auth=usePrimaryAccountAuth(),actor=auth?.state==='admin'?auth.userId:null,[scope,setScope]=useState(actor);
 if(actor&&actor!==scope)setScope(actor);if((auth?.state==='signed-out'||auth?.state==='signed-in')&&scope)setScope(null);
 const visible=!!actor&&actor===scope;
 return <><SiteHeader/><main className="page-container dashboard-shell pb-8 pt-6">
  <nav aria-label="Навигация модератора" className="flex flex-wrap gap-4"><Link href="/admin" className="min-h-11 py-2 font-semibold underline">Разделы админки</Link><Link href="/cabinet" className="min-h-11 py-2 font-semibold underline">Личный кабинет</Link></nav>
  <h1 className="mt-4 text-2xl font-bold">Вакансии и заказы на модерации</h1>
  {!visible&&<div className="mt-4" role="status"><p>{auth?.state==='loading'?'Проверяем права. Данные модерации временно скрыты.':'Доступ администратора не подтверждён.'}</p>
   <Link href="/auth" className={`${draftButton} mt-3 inline-flex`}>Войти</Link><button type="button" className={`${draftButton} ml-3 mt-3`} onClick={()=>notifyAccountSessionChange(false)}>Проверить доступ</button></div>}
  {scope&&<WorkModerationWorkspace key={scope} actor={scope} visible={visible}/>}
 </main></>;
}
