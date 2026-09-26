import type { Metadata } from "next";
import { HomeListings } from "@/components/HomeListings";
import { ListingEntryNav } from "@/components/ListingEntryNav";
import { SiteHeader } from "@/components/SiteHeader";
import { parseListingPage } from "@/components/listings/ListingPages";
import type { ListingKind } from "@/lib/types";

type PageSearchParams = { kind?: string; page?: string };
type PageProps = { searchParams?: Promise<PageSearchParams> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = searchParams ? await searchParams : undefined;
  const kind = normalizeListingKind(params?.kind);
  const page = parseListingPage(params?.page);
  const query = new URLSearchParams();

  if (kind) query.set("kind", kind);
  if (page > 1) query.set("page", String(page));

  return {
    title: "Объявления",
    description: "Объявления на платформе БЛИЖНИЙ: продать, купить или отдать бесплатно.",
    alternates: { canonical: `/obyavleniya${query.size ? `?${query}` : ""}` },
  };
}

export const dynamic = "force-dynamic";

function normalizeListingKind(value?: string): ListingKind | undefined {
  return value === "prodam" || value === "kuplyu" || value === "otdam-darom" || value === "arenda" ? value : undefined;
}

export default async function Page({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : undefined;
  const activeKind = normalizeListingKind(params?.kind);
  const page = parseListingPage(params?.page);

  return (
    <>
      <SiteHeader />
      <main className="py-6 sm:py-8">
        <ListingEntryNav activeKind={activeKind} />
        <div className="mt-6 sm:mt-8">
          <HomeListings kind={activeKind} page={page} />
        </div>
      </main>
    </>
  );
}
