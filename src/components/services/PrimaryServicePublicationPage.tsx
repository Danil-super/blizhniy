"use client";
import {ServicePublicationsPanel} from './ServicePublicationsPanel';import {serviceFormLabels} from './ServicePublicationForm';import type {ServicePublicationKind} from '@/lib/service-publication-contract';
export function PrimaryServicePublicationPage({kind}:{kind:ServicePublicationKind}){
 return <main className="page-container py-6 sm:py-10"><div className="mx-auto min-w-0 max-w-3xl"><h1 className="mb-5 text-2xl font-bold">{serviceFormLabels[kind]}</h1><ServicePublicationsPanel kind={kind} create/></div></main>;
}
