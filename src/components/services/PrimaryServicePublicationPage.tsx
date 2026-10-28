"use client";
import {PrimaryServicePublicationEditor} from './PrimaryServicePublicationEditor';import {serviceFormLabels} from './ServicePublicationForm';import type {ServicePublicationKind} from '@/lib/service-publication-contract';
import {CookieCabinetProfileProvider} from '@/components/cabinet/CookieCabinetProfileProvider';
export function PrimaryServicePublicationPage({kind,initialId}:{kind:ServicePublicationKind;initialId?:string}){
 return <CookieCabinetProfileProvider><main className="page-container py-6 sm:py-10"><div className="mx-auto min-w-0 max-w-3xl"><h1 className="mb-5 text-2xl font-bold">{initialId?'Редактирование: ':''}{serviceFormLabels[kind]}</h1><PrimaryServicePublicationEditor kind={kind} initialId={initialId}/></div></main></CookieCabinetProfileProvider>;
}
