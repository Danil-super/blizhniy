import type { Metadata } from "next";
import { ListingFormPage } from "@/components/listings/ListingPages";
import { isDemoAdminBypassEnabled } from "@/lib/server-auth";

type PageProps = {
  searchParams?: Promise<{ admin?: string; category?: string; error?: string; kind?: string; subcategory?: string; draft?:string }>;
};

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const draft = (await searchParams)?.draft;
  const editing = typeof draft === "string" && draft.length > 0;
  return {
    title: editing ? "Редактировать объявление" : "Создать объявление",
    description: editing ? "Форма редактирования объявления." : "Форма создания объявления с переходом к оплате публикации.",
    alternates: { canonical: "/razmestit/obyavlenie" },
    robots: { index: false, follow: true },
  };
}

export default async function Page({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : undefined;
  const adminMode = params?.admin === "1" && isDemoAdminBypassEnabled();

  return (
    <ListingFormPage
      draftId={params?.draft}
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
