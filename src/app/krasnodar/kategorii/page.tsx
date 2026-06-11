import type { Metadata } from "next";
import { CategoriesPage } from "@/components/listings/ListingPages";

export const metadata: Metadata = {
  title: "Категории объявлений в Краснодаре",
  description: "Плиточный каталог категорий и подкатегорий объявлений на БЛИЖНИЙ.",
  alternates: {
    canonical: "/krasnodar/kategorii",
  },
};

export default function Page() {
  return <CategoriesPage />;
}
