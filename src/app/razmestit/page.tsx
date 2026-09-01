import type { Metadata } from "next";
import { PublicationChoicePage } from "@/components/PublicationChoicePage";
import { isDemoAdminBypassEnabled } from "@/lib/server-auth";

export const metadata: Metadata = {
  title: "Разместить публикацию",
  description: "Выбор типа публикации на платформе БЛИЖНИЙ.",
  robots: {
    index: false,
    follow: true,
  },
};

type PageProps = {
  searchParams?: Promise<{ admin?: string }>;
};

export default async function Page({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : undefined;
  const adminMode = params?.admin === "1" && isDemoAdminBypassEnabled();

  return <PublicationChoicePage adminMode={adminMode} />;
}
