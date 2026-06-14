import type { Metadata } from "next";
import { PublicListingKindPage } from "@/components/listings/PublicListingSections";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Продам",
  description: "Объявления о продаже товаров на БЛИЖНИЙ.",
  alternates: {
    canonical: "/obyavleniya/prodam",
  },
};

export default function Page() {
  return <PublicListingKindPage kind="prodam" />;
}
