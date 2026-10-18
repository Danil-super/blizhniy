import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { FairApplicationFormPage } from "@/components/FairPages";
import { PublicationAuthGate } from "@/components/auth/PublicationAuthGate";
import { isDemoAdminBypassEnabled } from "@/lib/server-auth";
import {PrimaryServicePublicationPage} from '@/components/services/PrimaryServicePublicationPage';

type PageProps = {
  searchParams?: Promise<{ admin?: string }>;
};

export const metadata: Metadata = {
  title: "Заявка на ярмарку мастеров",
  robots: {
    index: false,
    follow: true,
  },
};

export default async function Page({ searchParams }: PageProps) {
  if(process.env.BLIZHNIY_AUTH_MODE==='postgres')return <><SiteHeader/><PublicationAuthGate preserveDraftDuringRecheck title="Войдите, чтобы подать заявку"><PrimaryServicePublicationPage kind="fair"/></PublicationAuthGate></>;
  const params = searchParams ? await searchParams : undefined;
  const adminMode = params?.admin === "1" && isDemoAdminBypassEnabled();

  return (
    <>
      <SiteHeader />
      <PublicationAuthGate title="Войдите, чтобы подать заявку">
        <FairApplicationFormPage adminMode={adminMode} />
      </PublicationAuthGate>
    </>
  );
}
