"use client";
import {useCallback,useState} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {PrimaryPaymentHistory} from '@/components/cabinet/PrimaryPaymentHistory';
import {ApplicationPaymentReturnClient} from './ApplicationPaymentReturnClient';

export function HostedResponseReturn({paymentId,cancellationEnabled=false}:{paymentId:string;cancellationEnabled?:boolean}){
 const user=usePrimaryAccountAuth();
 const [closed,setClosed]=useState<string|null>(null);
 const orderScope=user?.userId+':'+paymentId;
 const showReceipt=useCallback(()=>setClosed(orderScope),[orderScope]);
 if(closed!==orderScope&&user?.applicationTest===true&&(user.state==='signed-in'||user.state==='admin')){
  return <ApplicationPaymentReturnClient paymentId={paymentId} cancellationEnabled={cancellationEnabled} hosted onCheckoutClosed={showReceipt}/>;
 }
 return <main className="page-container max-w-3xl py-8"><h1 className="mb-4 text-2xl font-bold">Статус оплаты</h1>
  <PrimaryPaymentHistory receipt={{id:paymentId,targetType:'application'}}/></main>;
}
