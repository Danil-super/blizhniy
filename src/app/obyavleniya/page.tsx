import type { Metadata } from "next";
import { ListingEntryNav } from "@/components/ListingEntryNav";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Объявления",
  description: "Объявления на платформе БЛИЖНИЙ: продать, купить, обменять или отдать бесплатно.",
  alternates: {
    canonical: "/obyavleniya",
  },
};

export default function Page() {
  return (
    <>
      <SiteHeader />
      <main className="py-6 sm:py-8">
        <ListingEntryNav />
      </main>
    </>
  );
}
