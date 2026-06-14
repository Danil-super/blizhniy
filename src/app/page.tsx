import { CategoryGrid } from "@/components/CategoryGrid";
import { HomeHero } from "@/components/HomeHero";
import { HomeListings } from "@/components/HomeListings";
import { ListingEntryNav } from "@/components/ListingEntryNav";
import { SiteHeader } from "@/components/SiteHeader";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <HomeHero />
        <ListingEntryNav />
        <CategoryGrid />
        <HomeListings />
      </main>
    </>
  );
}
