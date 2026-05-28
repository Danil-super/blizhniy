import type { Metadata } from "next";
import { ListingFormPage } from "@/components/listings/ListingPages";

export const metadata: Metadata = {
  title: "Создать объявление в Краснодаре",
  description: "Форма создания объявления с переходом к оплате публикации.",
  alternates: {
    canonical: "/blizhniy/sozdat/obyavlenie",
  },
};

type PageProps = {
  searchParams?: Promise<{ admin?: string }>;
};

export default async function Page({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : undefined;
  const adminMode = params?.admin === "1";

  return <ListingFormPage adminMode={adminMode} />;
}
