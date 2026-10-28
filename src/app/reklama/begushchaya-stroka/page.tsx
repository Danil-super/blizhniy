import { AdMarqueePlacementClient } from "@/components/AdMarqueePlacementClient";
import { PublicationAuthGate } from "@/components/auth/PublicationAuthGate";
import { SiteHeader } from "@/components/SiteHeader";
import { getPublicTariffs } from "@/lib/public-tariffs";
import {PrimaryServicePublicationPage} from '@/components/services/PrimaryServicePublicationPage';
import {ServicePublicationsPanel} from '@/components/services/ServicePublicationsPanel';

export const dynamic = "force-dynamic";

export default async function Page({searchParams}:{searchParams?:Promise<{draft?:string;view?:string}>}) {
  const params=await searchParams;
  if(process.env.BLIZHNIY_AUTH_MODE==='postgres')return <><SiteHeader/><PublicationAuthGate preserveDraftDuringRecheck title="Войдите, чтобы разместить рекламу">{params?.view==='list'?<main className="page-container py-6"><h1 className="mb-5 text-2xl font-bold">Мои рекламные тексты</h1><ServicePublicationsPanel kind="marquee"/></main>:<PrimaryServicePublicationPage kind="marquee" initialId={params?.draft}/>}</PublicationAuthGate></>;
  const tariff = (await getPublicTariffs()).find((item) => item.action === "ad_marquee" && item.active);

  return (
    <>
      <SiteHeader />
      <PublicationAuthGate title="Войдите, чтобы разместить рекламу в бегущей строке">
        <main className="page-container py-6 sm:py-10">
          <AdMarqueePlacementClient tariff={tariff} />
        </main>
      </PublicationAuthGate>
    </>
  );
}
