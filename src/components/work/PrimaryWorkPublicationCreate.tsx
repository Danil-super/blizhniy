"use client";
import {useEffect,useState} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {FormPanel} from '@/components/FormPanel';
import {WorkPublicationForm} from './WorkPublicationForm';
import type {WorkPublicationKind} from '@/lib/work-publication-contract';
import {productionProfile} from '@/lib/client-postgres-profile';
import {vacancyEmployerPrefill,type VacancyEmployerPrefill} from '@/lib/vacancy-employer-defaults';
export function PrimaryWorkPublicationCreate({kind}:{kind:WorkPublicationKind}){
 const auth=usePrimaryAccountAuth(),owner=auth?.state==='signed-in'||auth?.state==='admin'?auth.userId:null;
 // PublicationAuthGate retains the same component while a known owner is rechecked.
 // Its keyed private boundary destroys this buffer on a confirmed account change.
 const [scope]=useState(owner);
 const [prefill,setPrefill]=useState<VacancyEmployerPrefill|null>();
 useEffect(()=>{
  if(kind!=='vacancy'||!scope||owner!==scope||prefill!==undefined)return;
  const controller=new AbortController();
  void productionProfile.read(scope,{signal:controller.signal}).then(({profile,revision})=>{
   if(!controller.signal.aborted)setPrefill(revision===null?null:vacancyEmployerPrefill(profile));
  }).catch(()=>{
   if(!controller.signal.aborted)setPrefill(null);
  });
  return ()=>controller.abort();
 },[kind,owner,prefill,scope]);
 return <main className="page-container py-6"><FormPanel title={kind==='vacancy'?'Разместить вакансию':'Разместить заказ'}
  description={kind==='vacancy'?'Укажите работодателя, условия работы и требования к кандидату.':'Опишите задачу и укажите, где нужно выполнить работу.'}>
  {scope?<WorkPublicationForm key={scope} owner={scope} kind={kind} employerPrefill={prefill??undefined} hostedTest={owner===scope&&auth?.workPublicationTest===true}/>:<p role="status">Проверяем вход…</p>}
 </FormPanel></main>;
}
