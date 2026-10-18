"use client";
import type {ReactNode} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {CabinetAuthGate} from '@/components/auth/CabinetAuthGate';
/** New publication panels retain and hide their own owner-scoped state during rechecks. */
export function CabinetPublicationWorkspace({children}:{children:ReactNode}){
 return usePrimaryAccountAuth()?children:<CabinetAuthGate>{children}</CabinetAuthGate>;
}
