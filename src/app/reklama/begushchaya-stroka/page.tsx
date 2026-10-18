import { AdMarqueePlacementClient } from "@/components/AdMarqueePlacementClient";
import { PublicationAuthGate } from "@/components/auth/PublicationAuthGate";
import { SiteHeader } from "@/components/SiteHeader";
import { getPublicTariffs } from "@/lib/public-tariffs";
import {PrimaryServicePublicationPage} from '@/components/services/PrimaryServicePublicationPage';

export const dynamic = "force-dynamic";

export default async function Page() {
  if(process.env.BLIZHNIY_AUTH_MODE==='postgres')return <><SiteHeader/><PublicationAuthGate preserveDraftDuringRecheck title="Войдите, чтобы разместить рекламу"><PrimaryServicePublicationPage kind="marquee"/></PublicationAuthGate></>;
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
