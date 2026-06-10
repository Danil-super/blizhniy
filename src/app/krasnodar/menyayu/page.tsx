import type { Metadata } from "next";
import { ListingKindPage } from "@/components/listings/ListingPages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Меняю в Краснодаре",
  description: "Объявления об обмене товарами в Краснодаре на БЛИЖНИЙ.",
  alternates: {
    canonical: "/blizhniy/menyayu",
  },
};

export default function Page() {
  return <ListingKindPage kind="menyayu" />;
}
