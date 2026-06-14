import type { Metadata } from "next";
import { CategoriesPage } from "@/components/listings/ListingPages";

export const metadata: Metadata = {
  title: "Каталог категорий",
  description: "Каталог категорий и подкатегорий объявлений на платформе БЛИЖНИЙ.",
  alternates: {
    canonical: "/katalog",
  },
};

export default function Page() {
  return <CategoriesPage />;
}
