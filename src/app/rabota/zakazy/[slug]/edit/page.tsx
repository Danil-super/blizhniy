import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { WorkRequestEditClient } from "@/components/WorkRequestEditClient";
import { PublicationAuthGate } from "@/components/auth/PublicationAuthGate";
import { workRequests } from "@/lib/data";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function EditWorkRequestPage({ params }: PageProps) {
  const { slug } = await params;
  // An edit URL is public. Production data is loaded by the client from the
  // authenticated, owner-scoped cabinet endpoint rather than serialized here.
  const initialRequest = shouldShowFallbackContent() ? workRequests.find((request) => request.id === slug) : undefined;

  return (
    <>
      <SiteHeader />
      <PublicationAuthGate title="Войдите, чтобы редактировать заказ">
        <WorkRequestEditClient requestId={slug} initialRequest={initialRequest} />
      </PublicationAuthGate>
    </>
  );
}
