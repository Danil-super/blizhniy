"use client";
import {useState} from 'react';import Link from 'next/link';import {AdminWorkspaceShell} from '@/components/admin/AdminShell';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';import {notifyAccountSessionChange} from '@/lib/local-account';
import type {ServicePublicationKind} from '@/lib/service-publication-contract';import {draftButton} from '@/components/listings/PrivateDraftEditor';
import {ServiceModerationWorkspace} from './ServiceModerationWorkspace';import {serviceFormLabels} from './ServicePublicationForm';
export function ServiceModerationPage({kind}:{kind:ServicePublicationKind}){
 const auth=usePrimaryAccountAuth(),actor=auth?.state==='admin'?auth.userId:null,[scope,setScope]=useState(actor);
 if(actor&&actor!==scope)setScope(actor);if((auth?.state==='signed-out'||auth?.state==='signed-in')&&scope)setScope(null);const visible=!!actor&&actor===scope;
 const activeHref={specialist:'/admin/specialisty',fair:'/admin/fair-applications',marquee:'/admin/ad-marquee'}[kind];
 return <AdminWorkspaceShell activeHref={activeHref} title={serviceFormLabels[kind]} description="Модерация материалов: проверяйте форму, фотографии и контакты автора.">
  {!visible&&<div className="mt-4" role="status"><p>{auth?.state==='loading'?'Проверяем права. Данные модерации временно скрыты.':'Доступ администратора не подтверждён.'}</p>
   <Link href="/auth" className={`${draftButton} mt-3 inline-flex`}>Войти</Link><button type="button" className={`${draftButton} ml-3 mt-3`} onClick={()=>notifyAccountSessionChange(false)}>Проверить доступ</button></div>}
  {scope&&<ServiceModerationWorkspace key={`${scope}:${kind}`} actor={scope} kind={kind} visible={visible}/>}
 </AdminWorkspaceShell>;
}
