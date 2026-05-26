import type { Metadata } from "next";
import { ListingFormPage } from "@/components/listings/ListingPages";

export const metadata: Metadata = {
  title: "Создать объявление в Краснодаре",
  description: "Форма создания объявления с переходом к оплате публикации.",
  alternates: {
    canonical: "/blizhniy/sozdat/obyavlenie",
  },
};

export default function Page() {
  return <ListingFormPage />;
}
