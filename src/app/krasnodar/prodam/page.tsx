import type { Metadata } from "next";
import { ListingKindPage } from "@/components/listings/ListingPages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Продам в Краснодаре",
  description: "Объявления о продаже товаров в Краснодаре на БЛИЖНИЙ.",
  alternates: {
    canonical: "/blizhniy/prodam",
  },
};

export default function Page() {
  return <ListingKindPage kind="prodam" />;
}
