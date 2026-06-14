import type { Metadata } from "next";
import { PublicListingKindPage } from "@/components/listings/PublicListingSections";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Куплю в Краснодаре",
  description: "Запросы покупателей в Краснодаре на БЛИЖНИЙ.",
  alternates: {
    canonical: "/krasnodar/kuplyu",
  },
};

export default function Page() {
  return <PublicListingKindPage kind="kuplyu" />;
}
