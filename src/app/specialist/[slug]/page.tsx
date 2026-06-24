import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { SpecialistProfileDetail } from "@/components/SpecialistProfileDetail";
import { ListingViewTracker } from "@/components/listings/ListingViewTracker";
import { hasMapCoordinates } from "@/lib/map-location";
import { listSpecialists } from "@/lib/mock-store";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";
import { getStoredSpecialistProfileById } from "@/lib/specialist-profile-store";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const specialist = (await getStoredSpecialistProfileById(slug)) ?? (shouldShowFallbackContent() ? listSpecialists().find((item) => item.id === slug) : undefined);

  return {
    title: specialist ? `${specialist.name} — ${specialist.profession}` : "Специалист",
    description: specialist ? `${specialist.skills}. ${specialist.city}.` : "Карточка специалиста на платформе БЛИЖНИЙ.",
    alternates: {
      canonical: `/specialist/${slug}`,
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
      <SpecialistProfileDetail specialist={{ ...specialist, hasMapPoint }} />
    </>
  );
}
