import { AdMarqueePlacementClient } from "@/components/AdMarqueePlacementClient";
import { SiteHeader } from "@/components/SiteHeader";
import { getPublicTariffs } from "@/lib/tariff-store";

export const dynamic = "force-dynamic";

export default async function Page() {
  const tariff = (await getPublicTariffs()).find((item) => item.action === "ad_marquee" && item.active);

  return (
    <>
      <SiteHeader />
      <main className="page-container py-6 sm:py-10">
        <AdMarqueePlacementClient tariff={tariff} />
      </main>
    </>
  );
}
