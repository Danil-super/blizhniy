import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { WorkRequestEditClient } from "@/components/WorkRequestEditClient";
import { PublicationAuthGate } from "@/components/auth/PublicationAuthGate";
import { workRequests } from "@/lib/data";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";
import {WorkPublicationsPanel} from '@/components/work/WorkPublicationsPanel';

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function EditWorkRequestPage({ params }: PageProps) {
  const { slug } = await params;
  if(typeof process!=='undefined'&&process.env.BLIZHNIY_AUTH_MODE==='postgres')return <><SiteHeader/><PublicationAuthGate title="Войдите, чтобы редактировать заказ" preserveDraftDuringRecheck>
   <main className="page-container py-6"><h1 className="text-2xl font-bold">Редактирование заказа</h1><WorkPublicationsPanel kind="workRequest" initialId={slug}/></main>
  </PublicationAuthGate></>;
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
