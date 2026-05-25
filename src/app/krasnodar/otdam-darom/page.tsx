import type { Metadata } from "next";
import { ListingKindPage } from "@/components/listings/ListingPages";

export const metadata: Metadata = {
  title: "Отдам даром в Краснодаре",
  description: "Бесплатные объявления Краснодарского края на БЛИЖНИЙ.",
  alternates: {
    canonical: "/blizhniy/otdam-darom",
  },
};

export default function Page() {
  return <ListingKindPage kind="otdam-darom" />;
}
