import type { Metadata } from "next";
import { HomeListings } from "@/components/HomeListings";
import { ListingEntryNav } from "@/components/ListingEntryNav";
import { SiteHeader } from "@/components/SiteHeader";
import type { ListingKind } from "@/lib/types";

export const metadata: Metadata = {
  title: "Объявления",
  description: "Объявления на платформе БЛИЖНИЙ: продать, купить или отдать бесплатно.",
  alternates: {
    canonical: "/obyavleniya",
  },
};

export const dynamic = "force-dynamic";

function normalizeListingKind(value?: string): ListingKind | undefined {
  return value === "prodam" || value === "kuplyu" || value === "otdam-darom" || value === "arenda" ? value : undefined;
}

export default async function Page({ searchParams }: { searchParams?: Promise<{ kind?: string }> }) {
  const params = searchParams ? await searchParams : undefined;
  const activeKind = normalizeListingKind(params?.kind);

  return (
    <>
      <SiteHeader />
      <main className="py-6 sm:py-8">
        <ListingEntryNav activeKind={activeKind} />
        <div className="mt-6 sm:mt-8">
          <HomeListings kind={activeKind} />
        </div>
      </main>
    </>
  );
}
