import { NextResponse } from "next/server";
import { listStoredFairApplicationsForAdmin } from "@/lib/fair-application-store";
import { listStoredListingsForAdmin } from "@/lib/listing-store";
import { isAdminRequest, isDemoAdminBypassEnabled } from "@/lib/server-auth";
import { listStoredSpecialistProfilesForAdmin } from "@/lib/specialist-profile-store";
import { listStoredVacanciesForAdmin } from "@/lib/vacancy-store";
import { listStoredWorkRequestsForAdmin } from "@/lib/work-request-store";

export const dynamic = "force-dynamic";

type PublicationType = "fairApplications" | "listings" | "specialists" | "vacancies" | "workRequests";

function isPublicationType(value: string): value is PublicationType {
  return ["fairApplications", "listings", "specialists", "vacancies", "workRequests"].includes(value);
}

export async function GET(request: Request) {
  if (!(isDemoAdminBypassEnabled() || (await isAdminRequest(request)))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "";

  if (!isPublicationType(type)) {
    return NextResponse.json({ error: "Invalid publication type" }, { status: 400 });
  }

  try {
    if (type === "listings") {
      const rows = await listStoredListingsForAdmin();

      return NextResponse.json({
        rows: rows.map((listing) => ({
          id: listing.id,
          statusTargetId: listing.id,
          statusEntityType: "listing",
          href: `/obyavlenie/${listing.slug}`,
          editHref: `/obyavlenie/${listing.slug}/edit`,
          title: listing.title,
          category: listing.subcategory,
          city: listing.city,
          district: listing.district ?? listing.address ?? "",
          status: listing.status,
        })),
      });
    }

    if (type === "vacancies") {
      const rows = await listStoredVacanciesForAdmin();

      return NextResponse.json({
        rows: rows.map((vacancy) => ({
          id: vacancy.id,
          statusTargetId: vacancy.id,
          statusEntityType: "vacancy",
          images: vacancy.images,
          organization: vacancy.organization,
          title: vacancy.title,
          city: vacancy.city,
          address: vacancy.address ?? vacancy.district ?? "",
          status: vacancy.status,
          href: `/vakansiya/${vacancy.id}`,
          editHref: `/rabota/vakansii/${vacancy.id}/edit`,
        })),
      });
    }

    if (type === "workRequests") {
      const rows = await listStoredWorkRequestsForAdmin();

      return NextResponse.json({
        rows: rows.map((workRequest) => ({
          id: workRequest.id,
          statusTargetId: workRequest.id,
          statusEntityType: "workRequest",
          author: workRequest.author,
          title: workRequest.title,
          profession: workRequest.profession,
          city: workRequest.city,
          budget: workRequest.budget,
          status: workRequest.status,
          href: `/rabota/zakazy/${workRequest.id}`,
          editHref: `/rabota/zakazy/${workRequest.id}/edit`,
        })),
      });
    }

    if (type === "fairApplications") {
      const rows = await listStoredFairApplicationsForAdmin();

      return NextResponse.json({
        rows: rows.map((application) => ({
          ...application,
          statusTargetId: application.id,
          statusEntityType: "fairApplication",
        })),
      });
    }

    const rows = await listStoredSpecialistProfilesForAdmin();

    return NextResponse.json({
      rows: rows.map((specialist) => ({
        id: specialist.id,
        statusTargetId: specialist.id,
        statusEntityType: "specialist",
        name: specialist.name,
        profession: specialist.profession,
        city: specialist.city,
        district: specialist.district,
        status: specialist.status,
        href: `/specialist/${specialist.id}`,
        editHref: `/rabota/specialisty/anketa?from=${specialist.id}`,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load publications" }, { status: 500 });
  }
}
