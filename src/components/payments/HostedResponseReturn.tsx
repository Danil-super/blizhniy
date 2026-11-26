"use client";
import {useCallback,useState} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {PrimaryPaymentHistory} from '@/components/cabinet/PrimaryPaymentHistory';
import {ApplicationPaymentReturnClient} from './ApplicationPaymentReturnClient';

export function HostedResponseReturn({paymentId,cancellationEnabled=false}:{paymentId:string;cancellationEnabled?:boolean}){
 const user=usePrimaryAccountAuth();
 const verifiedOwner=user?.state==='signed-in'||user?.state==='admin'?user.userId:null;
 const admittedOwner=user?.applicationTest===true?verifiedOwner:null;
 const [owner,setOwner]=useState(admittedOwner);
 const [closed,setClosed]=useState<string|null>(null);
 // Keep the same owner's hidden checkout alive while its admission is being rechecked.
 if((verifiedOwner||user?.state==='signed-out')&&owner!==admittedOwner)setOwner(admittedOwner);
 const orderScope=owner+':'+paymentId;
 const showReceipt=useCallback(()=>setClosed(orderScope),[orderScope]);
 if(owner&&closed!==orderScope){
  return <ApplicationPaymentReturnClient key={orderScope} paymentId={paymentId} cancellationEnabled={cancellationEnabled} hosted onCheckoutClosed={showReceipt}/>;
 }
 return <main className="page-container max-w-3xl py-8"><h1 className="mb-4 text-2xl font-bold">Статус оплаты</h1>
  <PrimaryPaymentHistory receipt={{id:paymentId,targetType:'application'}}/></main>;
}
