"use client";
import {useState} from 'react';
import Link from 'next/link';
import {AdminWorkspaceShell} from '@/components/admin/AdminShell';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {notifyAccountSessionChange} from '@/lib/local-account';
import {draftButton} from '@/components/listings/PrivateDraftEditor';
import {WorkModerationWorkspace} from './WorkModerationWorkspace';
export function WorkModerationPage({activeHref='/admin/vakansii'}:{activeHref?:string}){
 const auth=usePrimaryAccountAuth(),actor=auth?.state==='admin'?auth.userId:null,[scope,setScope]=useState(actor);
 if(actor&&actor!==scope)setScope(actor);if((auth?.state==='signed-out'||auth?.state==='signed-in')&&scope)setScope(null);
 const visible=!!actor&&actor===scope;
 return <AdminWorkspaceShell activeHref={activeHref} title="Вакансии и заказы на модерации" description="Проверяйте публикации и принимайте решение без перехода в отдельную админку.">
  {!visible&&<div className="mt-4" role="status"><p>{auth?.state==='loading'?'Проверяем права. Данные модерации временно скрыты.':'Доступ администратора не подтверждён.'}</p>
   <Link href="/auth" className={`${draftButton} mt-3 inline-flex`}>Войти</Link><button type="button" className={`${draftButton} ml-3 mt-3`} onClick={()=>notifyAccountSessionChange(false)}>Проверить доступ</button></div>}
  {scope&&<WorkModerationWorkspace key={scope} actor={scope} visible={visible}/>}
 </AdminWorkspaceShell>;
}
