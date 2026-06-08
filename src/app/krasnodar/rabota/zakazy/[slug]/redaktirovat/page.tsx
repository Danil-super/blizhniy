import { SiteHeader } from "@/components/SiteHeader";
import { WorkRequestEditClient } from "@/components/WorkRequestEditClient";
import { PublicationAuthGate } from "@/components/auth/PublicationAuthGate";
import { workRequests } from "@/lib/data";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function EditWorkRequestPage({ params }: PageProps) {
  const { slug } = await params;
  const initialRequest = workRequests.find((request) => request.id === slug);

  return (
    <>
      <SiteHeader />
      <PublicationAuthGate title="Войдите, чтобы редактировать заказ">
        <WorkRequestEditClient requestId={slug} initialRequest={initialRequest} />
      </PublicationAuthGate>
    </>
  );
}
