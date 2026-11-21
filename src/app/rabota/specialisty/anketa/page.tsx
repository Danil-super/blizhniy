import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {SiteHeader} from '@/components/SiteHeader';
import {PublicationAuthGate} from '@/components/auth/PublicationAuthGate';
import {PrimaryServicePublicationPage} from '@/components/services/PrimaryServicePublicationPage';

export const metadata: Metadata = {
  title: "Анкета специалиста",
  robots: { index: false, follow: false },
};

export const dynamic='force-dynamic';
export default async function SpecialistProfileFormPage({searchParams}:{searchParams?:Promise<{draft?:string}>}) {
  if(process.env.BLIZHNIY_AUTH_MODE==='postgres')return <><SiteHeader/><PublicationAuthGate preserveDraftDuringRecheck title="Войдите, чтобы заполнить анкету"><PrimaryServicePublicationPage kind="specialist" initialId={(await searchParams)?.draft}/></PublicationAuthGate></>;
  redirect("/cabinet/specialist");
}
