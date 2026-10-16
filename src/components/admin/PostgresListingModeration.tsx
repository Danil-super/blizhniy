"use client";
import Link from 'next/link';import {useState} from 'react';import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {notifyAccountSessionChange} from '@/lib/local-account';import {ListingModerationWorkspace} from './ListingModerationWorkspace';
import {draftButton} from '@/components/listings/PrivateDraftEditor';
/** Private display boundary only; every API operation independently checks the current database role. */
export function PostgresListingModeration(){
 const auth=usePrimaryAccountAuth(),actor=auth?.state==='admin'?auth.userId:null;
 const [scopeActor,setScopeActor]=useState(actor);
 if(actor&&actor!==scopeActor)setScopeActor(actor);
 if((auth?.state==='signed-out'||auth?.state==='signed-in')&&scopeActor)setScopeActor(null);
 const visible=actor!==null&&actor===scopeActor;
 return <>
  {!visible&&<div className="mt-4" role="status"><p>{auth?.state==='loading'?'Проверяем права. Данные модерации временно скрыты.':'Доступ администратора не подтверждён.'}</p>
   <Link href="/auth" className={`${draftButton} mt-3 inline-flex`}>Войти</Link>
   <button type="button" className={`${draftButton} ml-3 mt-3`} onClick={()=>notifyAccountSessionChange(false)}>Проверить доступ</button>
  </div>}
  {scopeActor&&<ListingModerationWorkspace key={scopeActor} actor={scopeActor} visible={visible}/>}
 </>;
}
