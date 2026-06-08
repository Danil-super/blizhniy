import { SiteHeader } from "@/components/SiteHeader";
import { FairApplicationFormPage } from "@/components/FairPages";
import { PublicationAuthGate } from "@/components/auth/PublicationAuthGate";

type PageProps = {
  searchParams?: Promise<{ admin?: string }>;
};

export default async function Page({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : undefined;
  const adminMode = params?.admin === "1";

  return (
    <>
      <SiteHeader />
      <PublicationAuthGate title="Войдите, чтобы подать заявку">
        <FairApplicationFormPage adminMode={adminMode} />
      </PublicationAuthGate>
    </>
  );
}
