import type { Metadata } from "next";
import { ListingFormPage } from "@/components/listings/ListingPages";

export const metadata: Metadata = {
  title: "Создать объявление в Краснодаре",
  description: "MVP-форма создания объявления с подготовкой к mock-оплате.",
  alternates: {
    canonical: "/blizhniy/sozdat",
  },
};

export default function Page() {
  return <ListingFormPage />;
}
