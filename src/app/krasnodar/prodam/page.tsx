import type { Metadata } from "next";
import { PublicListingKindPage } from "@/components/listings/PublicListingSections";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Продам в Краснодаре",
  description: "Объявления о продаже товаров в Краснодаре на БЛИЖНИЙ.",
  alternates: {
    canonical: "/krasnodar/prodam",
  },
};

export default function Page() {
  return <PublicListingKindPage kind="prodam" />;
}
