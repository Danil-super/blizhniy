import type { Metadata } from "next";
import { ListingFormPage } from "@/components/listings/ListingPages";
import { isDemoAdminBypassEnabled } from "@/lib/server-auth";

export const metadata: Metadata = {
  title: "Создать объявление в Краснодаре",
  description: "Форма создания объявления с переходом к оплате публикации.",
  alternates: {
    canonical: "/blizhniy/sozdat/obyavlenie",
  },
};

type PageProps = {
  searchParams?: Promise<{ admin?: string; category?: string; error?: string; kind?: string; subcategory?: string }>;
};

export default async function Page({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : undefined;
  const adminMode = params?.admin === "1" && isDemoAdminBypassEnabled();

  return (
    <ListingFormPage
      adminMode={adminMode}
      error={params?.error}
      defaults={{
        categorySlug: params?.category,
        kind: params?.kind,
        subcategorySlug: params?.subcategory,
      }}
    />
  );
}
