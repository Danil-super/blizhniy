"use client";
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {CabinetAuthGate} from '@/components/auth/CabinetAuthGate';
import type {ReactNode} from 'react';
import {PrivateDraftsPanel} from './PrivateDraftsPage';
import {CabinetStart} from '@/components/cabinet/CabinetStart';
/** Primary drafts own their private display boundary and preserve state through session rechecks. */
export function CabinetDraftWorkspace({children,footer,overview=false}:{children:ReactNode;footer?:ReactNode;overview?:boolean}){
 const primary=usePrimaryAccountAuth();
 const signedIn=primary?.state==='signed-in'||primary?.state==='admin';
 return primary?<>{overview&&signedIn?<CabinetStart/>:null}<PrivateDraftsPanel/>{signedIn?footer:null}</>:<CabinetAuthGate>{children}{footer}</CabinetAuthGate>;
}
