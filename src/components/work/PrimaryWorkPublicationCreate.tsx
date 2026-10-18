"use client";
import {useState} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {FormPanel} from '@/components/FormPanel';
import {WorkPublicationForm} from './WorkPublicationForm';
import type {WorkPublicationKind} from '@/lib/work-publication-contract';
export function PrimaryWorkPublicationCreate({kind}:{kind:WorkPublicationKind}){
 const auth=usePrimaryAccountAuth(),owner=auth?.state==='signed-in'||auth?.state==='admin'?auth.userId:null;
 // PublicationAuthGate retains the same component while a known owner is rechecked.
 // Its keyed private boundary destroys this buffer on a confirmed account change.
 const [scope]=useState(owner);
 return <main className="page-container py-6"><FormPanel title={kind==='vacancy'?'Разместить вакансию':'Разместить заказ'}
  description="Заполните данные, сохраните их или отправьте на проверку модератору.">
  {scope?<WorkPublicationForm key={scope} owner={scope} kind={kind}/>:<p role="status">Проверяем вход…</p>}
 </FormPanel></main>;
}
