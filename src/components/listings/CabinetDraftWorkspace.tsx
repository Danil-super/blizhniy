"use client";
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {CabinetAuthGate} from '@/components/auth/CabinetAuthGate';
import type {ReactNode} from 'react';
import {PrivateDraftsPanel} from './PrivateDraftsPage';
/** Primary drafts own their private display boundary and preserve state through session rechecks. */
export function CabinetDraftWorkspace({children,footer}:{children:ReactNode;footer?:ReactNode}){
 const primary=usePrimaryAccountAuth();
 return primary?<><PrivateDraftsPanel/>{primary.state==='signed-in'||primary.state==='admin'?footer:null}</>:<CabinetAuthGate>{children}{footer}</CabinetAuthGate>;
}
