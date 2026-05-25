import type { Metadata } from "next";
import { ListingKindPage } from "@/components/listings/ListingPages";

export const metadata: Metadata = {
  title: "Куплю в Краснодаре",
  description: "Запросы покупателей в Краснодаре на БЛИЖНИЙ.",
  alternates: {
    canonical: "/blizhniy/kuplyu",
  },
};

export default function Page() {
  return <ListingKindPage kind="kuplyu" />;
}
