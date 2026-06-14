import type { Metadata } from "next";
import { PublicListingKindPage } from "@/components/listings/PublicListingSections";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Меняю в Краснодаре",
  description: "Объявления об обмене товарами в Краснодаре на БЛИЖНИЙ.",
  alternates: {
    canonical: "/krasnodar/menyayu",
  },
};

export default function Page() {
  return <PublicListingKindPage kind="menyayu" />;
}
