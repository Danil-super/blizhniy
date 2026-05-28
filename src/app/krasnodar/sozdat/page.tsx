import type { Metadata } from "next";
import { PublicationChoicePage } from "@/components/PublicationChoicePage";

export const metadata: Metadata = {
  title: "Разместить публикацию в Краснодаре",
  description: "Выбор типа публикации на платформе БЛИЖНИЙ.",
  alternates: {
    canonical: "/blizhniy/sozdat",
  },
};

type PageProps = {
  searchParams?: Promise<{ admin?: string }>;
};

export default async function Page({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : undefined;
  const adminMode = params?.admin === "1";

  return <PublicationChoicePage adminMode={adminMode} />;
}
