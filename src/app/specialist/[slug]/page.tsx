import { publicationOpenGraph } from "@/lib/publication-open-graph";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { SpecialistProfileDetail } from "@/components/SpecialistProfileDetail";
import { PublicationComplaintLink } from "@/components/PublicationComplaintLink";
import { ListingViewTracker } from "@/components/listings/ListingViewTracker";
import { hasMapCoordinates } from "@/lib/map-location";
import { listSpecialists } from "@/lib/mock-store";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";
import { getStoredSpecialistProfileById } from "@/lib/specialist-profile-store";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const specialist = (await getStoredSpecialistProfileById(slug)) ?? (shouldShowFallbackContent() ? listSpecialists().find((item) => item.id === slug) : undefined);

  const title = specialist ? `${specialist.name} — ${specialist.profession}` : "Специалист";
  const description = specialist ? `${specialist.skills || specialist.profession}. ${specialist.city}.` : "Карточка специалиста на платформе БЛИЖНИЙ.";
  const url = `/specialist/${slug}`;
  return {
    ...(specialist?.testPublication ? { robots: { index: false, follow: true } } : {}),
    title,
    description,
    openGraph: specialist ? publicationOpenGraph(title, description, url, specialist.images) : undefined,
    alternates: {
      canonical: url,
    },
  };
}

export default async function SpecialistDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const specialist = (await getStoredSpecialistProfileById(slug)) ?? (shouldShowFallbackContent() ? listSpecialists().find((item) => item.id === slug) : undefined);

  if (!specialist) {
    notFound();
  }

  if (specialist.status !== "published") {
    notFound();
  }

  const hasMapPoint = (specialist.hasMapPoint ?? true) && hasMapCoordinates(specialist.lat, specialist.lng);

  return (
    <>
      <SiteHeader />
      <ListingViewTracker listingId={`work-specialist-${specialist.id}`} />
      <SpecialistProfileDetail
        publicPage
        specialist={{ ...specialist, hasMapPoint }}
        complaintLink={<PublicationComplaintLink section="specialist" slug={specialist.id} />}
      />
    </>
  );
}
