"use client";

import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';

type Receipt = {owner:string;cabinet:string;result:'fulfilled'|'verified-test'};
const Context = createContext<{receipt:Receipt|null;rememberReceipt:(receipt:Receipt)=>void}|null>(null);

export function PlacementReturnNoticeProvider({children}:{children:ReactNode}){
 const pathname=usePathname();
 const account=usePrimaryAccountAuth();
 const owner=account?.state==='signed-in'||account?.state==='admin'?account.userId:null;
 const [receipt,rememberReceipt]=useState<Receipt|null>(null);
 const [previousPath,setPreviousPath]=useState(pathname);
 if(pathname!==previousPath){
  setPreviousPath(pathname);
  if(receipt&&receipt.cabinet!==pathname)rememberReceipt(null);
 }
 if(receipt&&receipt.owner!==owner)rememberReceipt(null);
 return <Context.Provider value={{receipt,rememberReceipt}}>{children}</Context.Provider>;
}

export function usePlacementReturnNotice(){
 const state=useContext(Context);
 if(!state)throw new Error('Missing PlacementReturnNoticeProvider');
 return state;
}

export function PlacementReturnNotice(){
 const pathname=usePathname();
 const {receipt}=usePlacementReturnNotice();
 const [ready,setReady]=useState(false);
 useEffect(()=>setReady(true),[]);
 const result=ready&&receipt?.cabinet===pathname?receipt.result:null;
 const message=result==='fulfilled'?'Размещение выполнено':result==='verified-test'?'Оплата подтверждена. TEST-платёж без списания денег.':null;
 return <div role="status" aria-atomic="true" className={message?'mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900':'sr-only'}>{message}</div>;
}
