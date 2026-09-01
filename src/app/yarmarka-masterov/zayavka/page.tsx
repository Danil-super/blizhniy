import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { FairApplicationFormPage } from "@/components/FairPages";
import { PublicationAuthGate } from "@/components/auth/PublicationAuthGate";
import { isDemoAdminBypassEnabled } from "@/lib/server-auth";

type PageProps = {
  searchParams?: Promise<{ admin?: string }>;
};

export const metadata: Metadata = {
  title: "Заявка на ярмарку мастеров",
  robots: {
    index: false,
    follow: true,
  },
};

export default async function Page({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : undefined;
  const adminMode = params?.admin === "1" && isDemoAdminBypassEnabled();

  return (
    <>
      <SiteHeader />
      <PublicationAuthGate title="Войдите, чтобы подать заявку">
        <FairApplicationFormPage adminMode={adminMode} />
      </PublicationAuthGate>
    </>
  );
}
